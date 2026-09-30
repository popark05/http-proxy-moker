import type { UsbConfigurationLike, UsbDeviceLike } from '../../../src/main/adb/transport/usb';
import type { UsbBackend } from '../../../src/main/adb/transport/usb-discovery';
import { FakeDevice, type ServiceHandler } from './fake-device';

const PACKET = 512;
const IN_EP = 1;
const OUT_EP = 2;

/**
 * node-usb(WebUSB) UsbDevice를 흉내 내는 가짜 USB 기기. 내부의 FakeDevice가 ADB를 말한다.
 *
 * 실제 동작을 그대로 재현한다:
 * - 기기는 메시지마다 헤더와 payload를 별도 전송으로 보내고, ZLP는 보내지 않는다(최악의 경우).
 * - transferIn은 버퍼를 패킷 크기 배수로 잡고, 짧은 패킷을 받거나 버퍼가 차면 끝난다.
 *   전송이 패킷 크기 배수로 끝났는데 버퍼가 남으면 다음 데이터를 계속 기다린다(교착 재현).
 * - 결과는 요청 길이로 잘린다(node-usb 동작). 잘려서 사라진 바이트는 truncatedBytes에 누적.
 * - timeout 만료는 "transferIn error: Cancelled"로 reject(받던 데이터는 버림).
 */
export class FakeUsbDevice implements UsbDeviceLike {
  readonly vendorId = 0x18d1;
  readonly productId = 0x4ee7;
  readonly productName = 'Fake Pixel';
  readonly manufacturerName = 'Google';
  readonly adb: FakeDevice;

  opened = false;
  claimed = new Set<number>();
  /** claimInterface를 이 오류로 실패시킨다(adb server 점유 흉내). */
  claimError: Error | undefined;
  /** true면 transferOut이 끝나지 않는다(기기 정체). */
  stallWrites = false;
  /** configuration/configurations 접근 시 throw(열 수 없는 기기). */
  configurationThrows = false;
  /**
   * false면 구성이 아직 선택되지 않은 상태(macOS에서 0xEF 등 클래스 기기): configuration은 throw,
   * configurations는 목록을 준다. selectConfiguration으로 선택된다.
   */
  configurationSelected = true;
  selectedConfigurations: number[] = [];
  /** 앞으로 claimInterface가 이 횟수만큼 실패(Windows 인터페이스 준비 지연 흉내). */
  claimFailures = 0;
  /** ADB 인터페이스가 없는 기기(키보드 등). */
  hasAdb = true;

  readonly outTransfers: number[] = [];
  readonly clearedHalts: string[] = [];
  transferInCalls = 0;
  cancelledReads = 0;
  truncatedBytes = 0;
  disconnected = false;

  /** 기기 → 호스트 대기 중인 전송들. */
  private readonly queue: Buffer[] = [];
  private waiters: Array<() => void> = [];

  constructor(
    services: ServiceHandler,
    readonly serialNumber: string | null = 'FAKE123'
  ) {
    this.adb = new FakeDevice((bytes) => this.fromDevice(bytes), services);
  }

  get configuration(): UsbConfigurationLike {
    if (this.configurationThrows) throw new Error('configuration error: open error: access denied');
    if (!this.configurationSelected) throw new Error('configuration error: device is not configured');
    return this.buildConfiguration();
  }

  get configurations(): UsbConfigurationLike[] {
    if (this.configurationThrows) throw new Error('configuration error: open error: access denied');
    return [this.buildConfiguration()];
  }

  async selectConfiguration(value: number): Promise<void> {
    if (!this.opened) throw new Error('selectConfiguration error: invalid state');
    this.selectedConfigurations.push(value);
    this.configurationSelected = true;
  }

  private buildConfiguration(): UsbConfigurationLike {
    const mtp = {
      interfaceNumber: 0,
      alternates: [
        {
          alternateSetting: 0,
          interfaceClass: 0x06,
          interfaceSubclass: 0x01,
          interfaceProtocol: 0x01,
          endpoints: [
            { endpointNumber: 5, direction: 'in' as const, type: 'bulk', packetSize: PACKET },
            { endpointNumber: 6, direction: 'out' as const, type: 'bulk', packetSize: PACKET }
          ]
        }
      ]
    };
    const adb = {
      interfaceNumber: 1,
      alternates: [
        {
          alternateSetting: 0,
          interfaceClass: 0xff,
          interfaceSubclass: 0x42,
          interfaceProtocol: 0x01,
          endpoints: [
            { endpointNumber: IN_EP, direction: 'in' as const, type: 'bulk', packetSize: PACKET },
            { endpointNumber: OUT_EP, direction: 'out' as const, type: 'bulk', packetSize: PACKET }
          ]
        }
      ]
    };
    return { configurationValue: 1, interfaces: this.hasAdb ? [mtp, adb] : [mtp] };
  }

  async open(): Promise<void> {
    if (this.disconnected) throw new Error('open error: device disconnected');
    this.opened = true;
  }

  async close(): Promise<void> {
    this.opened = false;
    this.claimed.clear();
  }

  async claimInterface(n: number): Promise<void> {
    if (!this.opened) throw new Error('claimInterface error: invalid state');
    if (this.claimError) throw this.claimError;
    if (!this.configurationSelected) throw new Error('claimInterface error: device is not configured');
    if (this.claimFailures > 0) {
      this.claimFailures--;
      throw new Error('claimInterface error: interface not ready');
    }
    this.claimed.add(n);
  }

  async releaseInterface(n: number): Promise<void> {
    this.claimed.delete(n);
  }

  async selectAlternateInterface(): Promise<void> {}

  async clearHalt(direction: 'in' | 'out', ep: number): Promise<void> {
    this.clearedHalts.push(`${direction}${ep}`);
  }

  async transferIn(ep: number, length: number, timeout = 1000): Promise<{ data?: DataView; status: string }> {
    this.transferInCalls++;
    this.check(ep === IN_EP, 'transferIn');
    const rounded = Math.ceil(length / PACKET) * PACKET;
    const deadline = Date.now() + timeout;
    const parts: Buffer[] = [];
    let got = 0;

    for (;;) {
      if (this.queue.length === 0) {
        const remaining = deadline - Date.now();
        if (remaining <= 0 || !(await this.waitForData(remaining))) {
          if (this.disconnected) throw new Error('transferIn error: Disconnected');
          this.cancelledReads++;
          throw new Error('transferIn error: Cancelled');
        }
        continue;
      }
      const current = this.queue[0];
      const take = Math.min(current.length, rounded - got);
      parts.push(current.subarray(0, take));
      got += take;
      if (take < current.length) {
        this.queue[0] = current.subarray(take); // 버퍼가 참 → 전송 완료, 나머지는 다음 전송으로
        break;
      }
      this.queue.shift();
      if (current.length % PACKET !== 0 || got === rounded) break; // 짧은 패킷 or 버퍼 참
      // 패킷 크기 배수로 끝났고(ZLP 없음) 버퍼가 남음 → 실제 USB처럼 다음 데이터를 계속 기다린다.
    }

    const data = Buffer.concat(parts);
    this.truncatedBytes += Math.max(0, data.length - length);
    const result = data.subarray(0, length);
    return { data: new DataView(result.buffer, result.byteOffset, result.byteLength), status: 'ok' };
  }

  async transferOut(ep: number, data: Uint8Array, timeout = 1000): Promise<{ bytesWritten: number; status: string }> {
    this.check(ep === OUT_EP, 'transferOut');
    if (this.stallWrites) {
      await new Promise((r) => setTimeout(r, timeout));
      throw new Error('transferOut error: Cancelled');
    }
    this.outTransfers.push(data.length);
    this.adb.feed(Buffer.from(data));
    return { bytesWritten: data.length, status: 'ok' };
  }

  /** 케이블 뽑기: 대기 중인 읽기가 Disconnected로 실패한다. */
  unplug(): void {
    this.disconnected = true;
    this.wake();
  }

  // FakeDevice가 보낸 메시지 하나(헤더+payload)를 adbd처럼 두 전송으로 나눈다.
  private fromDevice(bytes: Uint8Array): void {
    const buffer = Buffer.from(bytes);
    this.queue.push(buffer.subarray(0, 24));
    if (buffer.length > 24) this.queue.push(buffer.subarray(24));
    this.wake();
  }

  private waitForData(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== wake);
        resolve(false);
      }, ms);
      const wake = (): void => {
        clearTimeout(timer);
        resolve(!this.disconnected && this.queue.length > 0);
      };
      this.waiters.push(wake);
    });
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((w) => w());
  }

  private check(validEndpoint: boolean, op: string): void {
    if (this.disconnected) throw new Error(`${op} error: Disconnected`);
    if (!this.opened || !this.claimed.has(1)) throw new Error(`${op} error: invalid state`);
    if (!validEndpoint) throw new Error(`${op} error: endpoint not found`);
  }
}

export class FakeUsbBackend implements UsbBackend {
  constructor(public devices: UsbDeviceLike[] = []) {}
  async getDevices(): Promise<UsbDeviceLike[]> {
    return this.devices;
  }
}
