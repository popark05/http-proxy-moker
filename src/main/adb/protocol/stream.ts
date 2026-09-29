/**
 * ADB 스트림(하나의 서비스 채널). dadb AdbStream/AdbMessageQueue 이식(Apache-2.0, NOTICE 참고).
 *
 * dadb는 스레드들이 공유 큐에서 (localId, command)로 메시지를 take()하지만, Node는 단일 스레드이므로
 * AdbConnection의 디스패치 루프가 localId로 스트림을 찾아 onOkay/onWrite/onRemoteClose를 호출한다.
 * (dadb의 락/lost-wakeup 문제는 이 구조에서 발생하지 않는다.)
 *
 * 흐름 제어:
 * - 수신: 기기는 WRTE마다 우리 OKAY를 기다린다. 소비자가 read()로 가져갈 때 OKAY를 보내 역압을 건다(dadb 동일).
 * - 송신: WRTE를 maxPayload 단위로 나눠 보내고, 각 WRTE마다 기기의 OKAY를 기다린다.
 *   (dadb는 송신 OKAY를 기다리지 않는다 — 프로토콜 규약대로 기다리도록 바꿈.)
 */

import type { AdbPacketWriter } from './packet-io';
import {
  AdbConnectionClosedException,
  AdbException,
  AdbStreamOpenException,
  AdbTimeoutException
} from '../errors';

/** 스트림이 연결에 요구하는 것(AdbConnection이 구현). */
export interface StreamHost {
  readonly writer: AdbPacketWriter;
  readonly maxPayloadSize: number;
  /** 기본 대기 시간(ms). 0이면 무제한. */
  readonly readTimeoutMs: number;
  unregister(localId: number): void;
}

type State = 'opening' | 'open' | 'closed';

interface Waiter<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class AdbStream {
  private state: State = 'opening';
  private remote = 0;
  /** 받았지만 아직 소비(OKAY)하지 않은 payload. */
  private readonly received: Buffer[] = [];
  private readonly readers: Array<Waiter<Buffer | null>> = [];
  private openWaiter: Waiter<void> | undefined;
  private ackWaiter: Waiter<void> | undefined;
  /** 원격이 CLSE를 보냈는가(남은 데이터를 다 읽으면 EOF). */
  private remoteClosed = false;
  /** 연결 오류로 끝났다면 그 오류. 이후 모든 작업이 이 오류로 실패한다. */
  private failure: AdbException | undefined;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly host: StreamHost,
    readonly localId: number,
    readonly destination: string
  ) {}

  get remoteId(): number {
    return this.remote;
  }

  get isClosed(): boolean {
    return this.state === 'closed';
  }

  /** 한 WRTE에 담을 수 있는 최대 바이트(기기가 CNXN에서 알려준 값). */
  get maxPayloadSize(): number {
    return this.host.maxPayloadSize;
  }

  /**
   * 다음 WRTE payload를 읽는다. 원격이 닫았고 남은 데이터가 없으면 null(EOF).
   * 타임아웃은 이 호출만 실패시키고 스트림은 계속 쓸 수 있다.
   */
  read(timeoutMs: number = this.host.readTimeoutMs): Promise<Buffer | null> {
    const next = this.received.shift();
    if (next) {
      this.acknowledge();
      return Promise.resolve(next);
    }
    if (this.failure) return Promise.reject(this.failure);
    if (this.remoteClosed || this.state === 'closed') return Promise.resolve(null);

    return new Promise<Buffer | null>((resolve, reject) => {
      const waiter: Waiter<Buffer | null> = { resolve, reject };
      waiter.timer = armTimeout(timeoutMs, () => {
        remove(this.readers, waiter);
        reject(new AdbTimeoutException(`스트림 읽기 시간 초과(${this.destination}, ${timeoutMs}ms)`));
      });
      this.readers.push(waiter);
    });
  }

  /** EOF까지 모두 읽는다. */
  async readAll(timeoutMs?: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for (;;) {
      const chunk = await this.read(timeoutMs);
      if (chunk === null) return Buffer.concat(chunks);
      chunks.push(chunk);
    }
  }

  /**
   * 데이터를 maxPayload 단위 WRTE로 보내고, 조각마다 기기의 OKAY를 기다린다.
   * 같은 스트림의 동시 write는 순서대로 직렬화된다(OKAY 대기가 한 번에 하나뿐이므로).
   */
  write(data: Uint8Array, timeoutMs: number = this.host.readTimeoutMs): Promise<void> {
    const result = this.writeTail.then(() => this.writeChunks(data, timeoutMs));
    this.writeTail = result.catch(() => undefined);
    return result;
  }

  private async writeChunks(data: Uint8Array, timeoutMs: number): Promise<void> {
    const max = this.host.maxPayloadSize;
    for (let offset = 0; offset < data.length; offset += max) {
      this.ensureWritable();
      const chunk = data.subarray(offset, Math.min(offset + max, data.length));
      const acked = new Promise<void>((resolve, reject) => {
        const waiter: Waiter<void> = { resolve, reject };
        waiter.timer = armTimeout(timeoutMs, () => {
          if (this.ackWaiter === waiter) this.ackWaiter = undefined;
          reject(new AdbTimeoutException(`스트림 쓰기 응답 시간 초과(${this.destination}, ${timeoutMs}ms)`));
        });
        this.ackWaiter = waiter;
      });
      // write가 실패하면 ack 대기는 의미가 없으므로 unhandled rejection이 나지 않게 흡수.
      acked.catch(() => undefined);
      await this.host.writer.writeWrite(this.localId, this.remote, chunk);
      await acked;
    }
  }

  /** 스트림을 닫는다(멱등). 대기 중인 read는 EOF, write는 실패한다. */
  async close(): Promise<void> {
    if (this.state === 'closed') return;
    const wasOpen = this.state === 'open' && !this.remoteClosed;
    this.finish();
    this.resolveReaders(null);
    this.rejectAck(new AdbConnectionClosedException(`스트림이 닫혔습니다(${this.destination}).`));
    if (wasOpen) {
      await this.host.writer.writeClose(this.localId, this.remote).catch(() => undefined);
    }
  }

  // ---- AdbConnection 디스패치 루프가 호출 ----

  /** OPEN 요청을 보낸 뒤 OKAY/CLSE를 기다린다. */
  waitOpened(timeoutMs: number = this.host.readTimeoutMs): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter<void> = { resolve, reject };
      waiter.timer = armTimeout(timeoutMs, () => {
        this.openWaiter = undefined;
        this.finish();
        reject(new AdbTimeoutException(`스트림 열기 시간 초과(${this.destination}, ${timeoutMs}ms)`));
      });
      this.openWaiter = waiter;
    });
  }

  onOkay(remoteId: number): void {
    if (this.state === 'opening') {
      this.remote = remoteId;
      this.state = 'open';
      settle(this.openWaiter)?.resolve();
      this.openWaiter = undefined;
      return;
    }
    const waiter = settle(this.ackWaiter);
    this.ackWaiter = undefined;
    waiter?.resolve();
  }

  onWrite(payload: Buffer): void {
    if (this.state !== 'open') return;
    const reader = settle(this.readers.shift());
    if (reader) {
      this.acknowledge();
      reader.resolve(payload);
    } else {
      this.received.push(payload);
    }
  }

  onRemoteClose(): void {
    if (this.state === 'opening') {
      // OPEN에 CLSE로 응답: adbd가 서비스를 거부. 연결은 계속 사용 가능.
      this.finish();
      settle(this.openWaiter)?.reject(
        new AdbStreamOpenException(this.destination, `adbd가 스트림 열기를 거부했습니다: ${this.destination}`)
      );
      this.openWaiter = undefined;
      return;
    }
    if (this.state === 'closed') return;
    this.remoteClosed = true;
    // dadb와 같이 원격 종료에 CLSE로 답하고 라우팅에서 뺀다. 남은 데이터는 계속 읽을 수 있다.
    void this.host.writer.writeClose(this.localId, this.remote).catch(() => undefined);
    this.finish();
    if (this.received.length === 0) this.resolveReaders(null);
    this.rejectAck(new AdbConnectionClosedException(`기기가 스트림을 닫았습니다(${this.destination}).`));
  }

  /** 연결 자체가 죽었을 때. 대기 중인 모든 작업을 오류로 깨운다. */
  fail(error: AdbException): void {
    if (this.failure) return;
    this.failure = error;
    this.finish();
    for (const reader of this.readers.splice(0)) settle(reader)?.reject(error);
    settle(this.openWaiter)?.reject(error);
    this.openWaiter = undefined;
    this.rejectAck(error);
  }

  // ---- 내부 ----

  private ensureWritable(): void {
    if (this.failure) throw this.failure;
    if (this.state !== 'open' || this.remoteClosed) {
      throw new AdbConnectionClosedException(`닫힌 스트림에 쓸 수 없습니다(${this.destination}).`);
    }
  }

  /** 소비한 WRTE에 OKAY로 응답(기기가 다음 WRTE를 보내도 됨). */
  private acknowledge(): void {
    if (this.state !== 'open') return;
    void this.host.writer.writeOkay(this.localId, this.remote).catch(() => undefined);
  }

  private finish(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.host.unregister(this.localId);
  }

  private resolveReaders(value: Buffer | null): void {
    for (const reader of this.readers.splice(0)) settle(reader)?.resolve(value);
  }

  private rejectAck(error: Error): void {
    settle(this.ackWaiter)?.reject(error);
    this.ackWaiter = undefined;
  }
}

function armTimeout(timeoutMs: number, onTimeout: () => void): ReturnType<typeof setTimeout> | undefined {
  return timeoutMs > 0 ? setTimeout(onTimeout, timeoutMs) : undefined;
}

/** 타이머를 해제하고 waiter를 돌려준다(없으면 undefined). */
function settle<T>(waiter: Waiter<T> | undefined): Waiter<T> | undefined {
  if (waiter?.timer) clearTimeout(waiter.timer);
  return waiter;
}

function remove<T>(list: T[], item: T): void {
  const idx = list.indexOf(item);
  if (idx >= 0) list.splice(idx, 1);
}
