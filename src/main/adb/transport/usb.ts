/**
 * USB 전송: adb server 없이 기기의 ADB 인터페이스(bulk IN/OUT)를 직접 사용한다. dadb에는 없는 확장
 * (dadb는 USB 기기를 adb server의 host:transport로만 다룬다).
 *
 * `usb` 패키지(node-usb 3.x, WebUSB API, N-API라 Electron 재빌드 불필요)를 쓰되, 테스트를 위해
 * 우리가 쓰는 WebUSB 표면(UsbDeviceLike)에만 의존한다.
 *
 * 읽기 규칙(AOSP client/usb_libusb.cpp와 동일): 헤더 24바이트를 먼저, 그다음 payload를 정확한 길이로 읽는다.
 * - node-usb의 transferIn은 버퍼를 패킷 크기 배수로 잡고 결과를 요청 길이로 "잘라낸다". 요청보다 많이 오면
 *   초과분이 사라지므로, adbd가 헤더/본문을 별도 전송으로 보낸다는 전제로 정확한 길이만 요청한다.
 * - 큰 버퍼로 뭉뚱그려 읽으면 payload가 패킷 크기 배수일 때(ZLP 없음) 전송이 끝나지 않아
 *   기기는 OKAY를, 우리는 전송 완료를 기다리는 교착이 생긴다.
 * - transferIn의 timeout은 만료 시 전송을 취소한다(0은 즉시 만료). 유휴 대기는 헤더 읽기를 짧은 주기로
 *   다시 시도한다. 헤더는 단일 패킷이라 취소돼도 일부만 받는 일이 없다. payload 도중의 시간 초과는 치명적이다.
 *
 * 쓰기 규칙: 전송 하나 = write 한 번. 길이가 패킷 크기의 배수면 ZLP(길이 0 전송)를 덧붙여 끝을 알린다
 * (AOSP의 LIBUSB_TRANSFER_ADD_ZERO_PACKET).
 */

import type { AdbTransport } from './transport';
import { AdbConnectException, AdbConnectionClosedException, AdbTimeoutException } from '../errors';
import { HEADER_LENGTH } from '../protocol/constants';

/** ADB 인터페이스 식별자(AOSP adb: ADB_CLASS/ADB_SUBCLASS/ADB_PROTOCOL). */
export const ADB_CLASS = 0xff;
export const ADB_SUBCLASS = 0x42;
export const ADB_PROTOCOL = 0x01;

// ---- 우리가 쓰는 WebUSB 표면(node-usb UsbDevice가 구조적으로 만족) ----

export interface UsbEndpointLike {
  endpointNumber: number;
  direction: 'in' | 'out';
  type: string;
  packetSize: number;
}

export interface UsbAlternateLike {
  alternateSetting: number;
  interfaceClass: number;
  interfaceSubclass: number;
  interfaceProtocol: number;
  endpoints: UsbEndpointLike[];
}

export interface UsbInterfaceLike {
  interfaceNumber: number;
  alternates: UsbAlternateLike[];
}

export interface UsbConfigurationLike {
  interfaces: UsbInterfaceLike[];
}

export interface UsbDeviceLike {
  readonly vendorId: number;
  readonly productId: number;
  readonly serialNumber?: string | null;
  readonly productName?: string | null;
  readonly manufacturerName?: string | null;
  readonly opened: boolean;
  /** node-usb는 열려 있지 않으면 내부적으로 열어서 읽는다(실패 시 throw). */
  readonly configuration?: UsbConfigurationLike | null;
  open(): Promise<void>;
  close(): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  selectAlternateInterface(interfaceNumber: number, alternateSetting: number): Promise<void>;
  clearHalt(direction: 'in' | 'out', endpointNumber: number): Promise<void>;
  /** node-usb 확장: 세 번째 인자가 timeout(ms). 만료 시 "…error: Cancelled"로 reject. */
  transferIn(endpointNumber: number, length: number, timeout?: number): Promise<{ data?: DataView; status: string }>;
  transferOut(
    endpointNumber: number,
    data: Uint8Array,
    timeout?: number
  ): Promise<{ bytesWritten: number; status: string }>;
}

export interface AdbUsbInterface {
  interfaceNumber: number;
  alternateSetting: number;
  inEndpoint: number;
  outEndpoint: number;
  /** bulk 최대 패킷 크기(USB 2.0 High-Speed 512, SuperSpeed 1024). ZLP 판단에 쓴다. */
  packetSize: number;
}

/** 기기에서 ADB 인터페이스(0xff/0x42/0x01 + bulk IN/OUT)를 찾는다. 없거나 읽을 수 없으면 undefined. */
export function findAdbInterface(device: UsbDeviceLike): AdbUsbInterface | undefined {
  let configuration: UsbConfigurationLike | null | undefined;
  try {
    configuration = device.configuration;
  } catch {
    return undefined;
  }
  for (const iface of configuration?.interfaces ?? []) {
    for (const alt of iface.alternates) {
      if (
        alt.interfaceClass !== ADB_CLASS ||
        alt.interfaceSubclass !== ADB_SUBCLASS ||
        alt.interfaceProtocol !== ADB_PROTOCOL
      ) {
        continue;
      }
      const bulkIn = alt.endpoints.find((e) => e.type === 'bulk' && e.direction === 'in');
      const bulkOut = alt.endpoints.find((e) => e.type === 'bulk' && e.direction === 'out');
      if (!bulkIn || !bulkOut) continue;
      return {
        interfaceNumber: iface.interfaceNumber,
        alternateSetting: alt.alternateSetting,
        inEndpoint: bulkIn.endpointNumber,
        outEndpoint: bulkOut.endpointNumber,
        packetSize: bulkOut.packetSize || 512
      };
    }
  }
  return undefined;
}

export interface UsbTransportOptions {
  /** 전송 하나가 끝나기까지의 기한(ms). 기본 10초(TcpTransport와 같은 의도). */
  writeTimeoutMs?: number;
  /** 유휴 시 헤더 읽기 재시도 주기(ms). close가 읽기 루프를 멈추는 데 걸리는 최대 시간이기도 하다. 기본 1초. */
  idlePollMs?: number;
  /** 헤더를 받은 뒤 payload를 모두 받기까지의 기한(ms). 기본 30초. */
  payloadTimeoutMs?: number;
}

const DEFAULT_WRITE_TIMEOUT = 10_000;
const DEFAULT_IDLE_POLL = 1_000;
const DEFAULT_PAYLOAD_TIMEOUT = 30_000;

export class UsbTransport implements AdbTransport {
  private readonly dataListeners: Array<(chunk: Uint8Array) => void> = [];
  private readonly closeListeners: Array<(error?: Error) => void> = [];
  private closed = false;
  private closeError: Error | undefined;
  private readLoop: Promise<void> = Promise.resolve();
  private releasing: Promise<void> | undefined;

  private constructor(
    private readonly device: UsbDeviceLike,
    readonly adbInterface: AdbUsbInterface,
    private readonly options: Required<UsbTransportOptions>
  ) {}

  /**
   * 기기를 열고 ADB 인터페이스를 점유한다.
   * adb server 등 다른 프로그램이 인터페이스를 잡고 있으면 AdbConnectException(원인 안내 포함).
   */
  static async open(device: UsbDeviceLike, options: UsbTransportOptions = {}): Promise<UsbTransport> {
    const adbInterface = findAdbInterface(device);
    if (!adbInterface) {
      throw new AdbConnectException(
        `ADB 인터페이스를 찾을 수 없습니다(${describeDevice(device)}). 기기에서 USB 디버깅이 켜져 있는지 확인하세요.`
      );
    }
    try {
      if (!device.opened) await device.open();
      await device.claimInterface(adbInterface.interfaceNumber);
      if (adbInterface.alternateSetting !== 0) {
        await device.selectAlternateInterface(adbInterface.interfaceNumber, adbInterface.alternateSetting);
      }
    } catch (e) {
      await device.close().catch(() => undefined);
      throw new AdbConnectException(
        `USB 기기의 ADB 인터페이스를 점유하지 못했습니다(${describeDevice(device)}). ` +
          'adb server 등 다른 프로그램이 기기를 사용 중일 수 있습니다(`adb kill-server`로 종료).',
        e
      );
    }
    // 이전 세션이 남긴 halt 상태를 지운다(AOSP도 연결 시 clear_halt). 실패는 무시.
    await device.clearHalt('in', adbInterface.inEndpoint).catch(() => undefined);
    await device.clearHalt('out', adbInterface.outEndpoint).catch(() => undefined);

    const transport = new UsbTransport(device, adbInterface, {
      writeTimeoutMs: options.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT,
      idlePollMs: options.idlePollMs ?? DEFAULT_IDLE_POLL,
      payloadTimeoutMs: options.payloadTimeoutMs ?? DEFAULT_PAYLOAD_TIMEOUT
    });
    transport.readLoop = transport.runReadLoop();
    return transport;
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.closed) throw this.closeError ?? new AdbConnectionClosedException('USB 연결이 닫혔습니다.');
    const { outEndpoint, packetSize } = this.adbInterface;
    try {
      await this.transferOut(outEndpoint, data);
      if (data.length > 0 && data.length % packetSize === 0) {
        await this.transferOut(outEndpoint, new Uint8Array(0));
      }
    } catch (e) {
      const error = isCancelled(e)
        ? new AdbTimeoutException(`USB 쓰기 시간 초과(${this.options.writeTimeoutMs}ms): 기기가 응답하지 않습니다.`, e)
        : new AdbConnectionClosedException('USB 쓰기 실패: 기기 연결이 끊겼습니다.', e);
      // 멈추거나 끊긴 USB 연결은 되살릴 수 없으므로 닫는다 → 다음 작업에서 재연결.
      void this.shutdown(error);
      throw error;
    }
  }

  onData(listener: (chunk: Uint8Array) => void): void {
    this.dataListeners.push(listener);
  }

  onClose(listener: (error?: Error) => void): void {
    if (this.closed) {
      queueMicrotask(() => listener(this.closeError));
      return;
    }
    this.closeListeners.push(listener);
  }

  close(): Promise<void> {
    return this.shutdown();
  }

  // ---- 내부 ----

  private async transferOut(endpoint: number, data: Uint8Array): Promise<void> {
    const result = await this.device.transferOut(endpoint, data, this.options.writeTimeoutMs);
    if (result.status !== 'ok') throw new Error(`transferOut status: ${result.status}`);
  }

  /** 헤더 → payload 순으로 정확한 길이만 읽어 청크로 내보낸다. */
  private async runReadLoop(): Promise<void> {
    try {
      while (!this.closed) {
        const header = await this.readExact(HEADER_LENGTH, true);
        if (!header) return; // 유휴 대기 중 close
        this.emit(header);
        const payloadLength = header.readUInt32LE(12);
        if (payloadLength > 0) {
          const payload = await this.readExact(payloadLength, false);
          if (!payload) return;
          this.emit(payload);
        }
      }
    } catch (e) {
      if (this.closed) return;
      const error = isCancelled(e)
        ? new AdbTimeoutException('USB 읽기 시간 초과: payload를 끝까지 받지 못했습니다.', e)
        : new AdbConnectionClosedException('USB 읽기 실패: 기기 연결이 끊겼습니다.', e);
      void this.shutdown(error);
    }
  }

  /**
   * 정확히 n바이트를 읽는다. idle이면 첫 바이트를 기다리는 동안 짧은 주기로 재시도하고,
   * 그 사이 close되면 null.
   */
  private async readExact(n: number, idle: boolean): Promise<Buffer | null> {
    const parts: Buffer[] = [];
    let have = 0;
    while (have < n) {
      if (this.closed) return null;
      const waitingForFirstByte = idle && have === 0;
      let result: { data?: DataView; status: string };
      try {
        result = await this.device.transferIn(
          this.adbInterface.inEndpoint,
          n - have,
          waitingForFirstByte ? this.options.idlePollMs : this.options.payloadTimeoutMs
        );
      } catch (e) {
        if (waitingForFirstByte && isCancelled(e)) continue; // 유휴: 다시 기다린다.
        throw e;
      }
      if (result.status !== 'ok') throw new Error(`transferIn status: ${result.status}`);
      const view = result.data;
      if (!view || view.byteLength === 0) continue; // ZLP
      parts.push(Buffer.from(view.buffer, view.byteOffset, view.byteLength));
      have += view.byteLength;
    }
    return parts.length === 1 ? parts[0] : Buffer.concat(parts);
  }

  private emit(chunk: Buffer): void {
    for (const listener of this.dataListeners) listener(chunk);
  }

  /** 닫기(멱등): 읽기 루프가 멈추길 잠깐 기다린 뒤 인터페이스를 놓고 기기를 닫는다. */
  private shutdown(error?: Error): Promise<void> {
    if (this.releasing) return this.releasing;
    this.closed = true;
    this.closeError = error;
    this.releasing = (async () => {
      // 유휴 읽기는 idlePollMs 안에 끝난다. payload 읽기 중이면 오래 걸릴 수 있어 상한을 둔다.
      await Promise.race([
        this.readLoop,
        new Promise((r) => setTimeout(r, this.options.idlePollMs + 1_000))
      ]);
      await this.device.releaseInterface(this.adbInterface.interfaceNumber).catch(() => undefined);
      await this.device.close().catch(() => undefined);
      for (const listener of this.closeListeners.splice(0)) listener(error);
    })();
    return this.releasing;
  }
}

/** node-usb는 timeout 만료를 전송 취소(Cancelled)로 보고한다. */
function isCancelled(error: unknown): boolean {
  return error instanceof Error && /Cancelled/i.test(error.message);
}

export function describeDevice(device: UsbDeviceLike): string {
  const id = `${hex4(device.vendorId)}:${hex4(device.productId)}`;
  const name = safe(() => device.productName) ?? '';
  const serial = safe(() => device.serialNumber) ?? '';
  return [name, id, serial && `serial=${serial}`].filter(Boolean).join(' ');
}

function hex4(value: number): string {
  return value.toString(16).padStart(4, '0');
}

/** node-usb의 문자열 getter는 기기를 열다가 throw할 수 있다. */
export function safe<T>(read: () => T | null | undefined): T | undefined {
  try {
    return read() ?? undefined;
  } catch {
    return undefined;
  }
}
