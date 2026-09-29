import type { AdbTransport } from '../../../src/main/adb/transport/transport';
import { MessageDecoder, encodeMessage, type AdbMessage } from '../../../src/main/adb/protocol/message';

/**
 * 테스트용 메모리 전송. 호스트가 write한 바이트는 기기 쪽(onHostBytes)으로,
 * 기기가 deliver한 바이트는 호스트의 onData로 전달된다.
 */
export class MemoryTransport implements AdbTransport {
  readonly writes: Uint8Array[] = [];
  closed = false;
  /** 설정하면 다음 write가 이 오류로 실패한다. */
  failNextWrite: Error | undefined;

  private dataListeners: Array<(chunk: Uint8Array) => void> = [];
  private closeListeners: Array<(error?: Error) => void> = [];

  constructor(private readonly onHostBytes: (bytes: Uint8Array) => void = () => {}) {}

  async write(data: Uint8Array): Promise<void> {
    if (this.failNextWrite) {
      const e = this.failNextWrite;
      this.failNextWrite = undefined;
      throw e;
    }
    if (this.closed) throw new Error('closed');
    this.writes.push(Buffer.from(data));
    this.onHostBytes(data);
  }

  onData(listener: (chunk: Uint8Array) => void): void {
    this.dataListeners.push(listener);
  }

  onClose(listener: (error?: Error) => void): void {
    this.closeListeners.push(listener);
  }

  async close(): Promise<void> {
    this.remoteClose();
  }

  /** 기기 → 호스트 바이트 전달. */
  deliver(bytes: Uint8Array): void {
    for (const l of this.dataListeners) l(bytes);
  }

  /** 기기 쪽에서 연결을 끊는다. */
  remoteClose(error?: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const l of this.closeListeners) l(error);
  }
}

/**
 * 스크립트형 가짜 adbd. 호스트 메시지를 디코딩해 handler에 넘기고,
 * handler가 돌려준 메시지들을 호스트로 전달한다.
 */
export class FakeAdbd {
  readonly received: AdbMessage[] = [];
  readonly transport: MemoryTransport;
  private readonly decoder = new MessageDecoder();

  constructor(private readonly handler: (message: AdbMessage, adbd: FakeAdbd) => AdbMessage[] | void) {
    this.transport = new MemoryTransport((bytes) => this.onHostBytes(bytes));
  }

  send(message: AdbMessage): void {
    this.transport.deliver(encodeMessage(message));
  }

  private onHostBytes(bytes: Uint8Array): void {
    for (const message of this.decoder.push(bytes)) {
      this.received.push(message);
      const replies = this.handler(message, this) ?? [];
      // 실제 기기처럼 비동기로 응답한다.
      queueMicrotask(() => replies.forEach((r) => this.send(r)));
    }
  }
}

export function msg(command: number, arg0: number, arg1: number, payload: string | Buffer = ''): AdbMessage {
  return {
    command,
    arg0,
    arg1,
    payload: typeof payload === 'string' ? Buffer.from(payload, 'utf-8') : payload
  };
}

export const DEVICE_BANNER =
  'device::ro.product.name=sdk_gphone64_arm64;ro.product.model=sdk_gphone64_arm64;' +
  'ro.product.device=emu64a;features=shell_v2,cmd,stat_v2,abb_exec,fixed_push_mkdir\0';
