/**
 * 전송 계층 위의 ADB 메시지 송수신기. dadb AdbReader/AdbWriter 이식(Apache-2.0, NOTICE 참고).
 *
 * - AdbPacketReader: 전송 청크를 디코딩해 큐에 쌓고, read()로 하나씩 꺼낸다(dadb readMessage 대응).
 * - AdbPacketWriter: 메시지를 헤더/본문으로 나눠 쓰고, 동시 호출이 섞이지 않도록 직렬화한다.
 *   모든 쓰기 실패는 여기서 AdbException으로 변환된다(dadb의 단일 funnel 설계).
 */

import type { AdbTransport } from '../transport/transport';
import {
  AdbConnectionClosedException,
  AdbException,
  AdbProtocolException,
  AdbTimeoutException
} from '../errors';
import {
  CMD_AUTH,
  CMD_CLSE,
  CMD_CNXN,
  CMD_OKAY,
  CMD_OPEN,
  CMD_WRTE,
  CONNECT_MAXDATA,
  CONNECT_PAYLOAD,
  CONNECT_VERSION
} from './constants';
import { MessageDecoder, encodeHeader, type AdbMessage } from './message';

interface PendingRead {
  resolve: (message: AdbMessage) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class AdbPacketReader {
  private readonly decoder: MessageDecoder;
  private readonly queue: AdbMessage[] = [];
  private readonly waiters: PendingRead[] = [];
  /** 한 번 실패하면 이후 read()는 모두 이 오류로 실패한다. */
  private failure: AdbException | undefined;

  constructor(transport: AdbTransport, maxPayload: number = CONNECT_MAXDATA) {
    this.decoder = new MessageDecoder(maxPayload);
    transport.onData((chunk) => this.onChunk(chunk));
    transport.onClose((error) =>
      this.fail(new AdbConnectionClosedException('ADB 연결이 종료되었습니다.', error))
    );
  }

  /**
   * 다음 메시지를 기다린다.
   * timeoutMs가 지나면 AdbTimeoutException(연결은 유지 — 호출자가 닫을지 결정).
   */
  read(timeoutMs?: number): Promise<AdbMessage> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    if (this.failure) return Promise.reject(this.failure);

    return new Promise<AdbMessage>((resolve, reject) => {
      const waiter: PendingRead = { resolve, reject };
      if (timeoutMs !== undefined && timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          const idx = this.waiters.indexOf(waiter);
          if (idx >= 0) this.waiters.splice(idx, 1);
          reject(new AdbTimeoutException(`ADB 메시지 대기 시간 초과(${timeoutMs}ms)`));
        }, timeoutMs);
      }
      this.waiters.push(waiter);
    });
  }

  private onChunk(chunk: Uint8Array): void {
    if (this.failure) return;
    let messages: AdbMessage[];
    try {
      messages = this.decoder.push(chunk);
    } catch (e) {
      this.fail(e instanceof AdbException ? e : new AdbProtocolException('ADB 메시지 디코딩 실패', e));
      return;
    }
    for (const message of messages) {
      const waiter = this.waiters.shift();
      if (waiter) {
        if (waiter.timer) clearTimeout(waiter.timer);
        waiter.resolve(message);
      } else {
        this.queue.push(message);
      }
    }
  }

  private fail(error: AdbException): void {
    if (this.failure) return;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
}

export class AdbPacketWriter {
  /** 직렬화 체인: 이전 메시지의 헤더+본문 쓰기가 끝난 뒤 다음 메시지를 쓴다. */
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly transport: AdbTransport) {}

  writeConnect(): Promise<void> {
    return this.write(CMD_CNXN, CONNECT_VERSION, CONNECT_MAXDATA, CONNECT_PAYLOAD);
  }

  writeAuth(authType: number, payload: Uint8Array): Promise<void> {
    return this.write(CMD_AUTH, authType, 0, payload);
  }

  writeOpen(localId: number, destination: string): Promise<void> {
    const payload = Buffer.concat([Buffer.from(destination, 'utf-8'), Buffer.from([0])]);
    return this.write(CMD_OPEN, localId, 0, payload);
  }

  writeWrite(localId: number, remoteId: number, payload: Uint8Array): Promise<void> {
    return this.write(CMD_WRTE, localId, remoteId, payload);
  }

  writeClose(localId: number, remoteId: number): Promise<void> {
    return this.write(CMD_CLSE, localId, remoteId);
  }

  writeOkay(localId: number, remoteId: number): Promise<void> {
    return this.write(CMD_OKAY, localId, remoteId);
  }

  write(command: number, arg0: number, arg1: number, payload?: Uint8Array): Promise<void> {
    const body = payload && payload.length > 0 ? payload : undefined;
    const run = async (): Promise<void> => {
      try {
        await this.transport.write(encodeHeader(command, arg0, arg1, body));
        if (body) await this.transport.write(body);
      } catch (e) {
        throw toWriteException(e);
      }
    };
    const result = this.tail.then(run);
    // 실패한 쓰기가 이후 쓰기를 막지 않도록 체인에는 성공/실패 무관하게 이어 붙인다.
    this.tail = result.catch(() => undefined);
    return result;
  }
}

/**
 * 쓰기 실패를 AdbException으로 변환. 타임아웃은 기기 정체(stall), 나머지는 연결 끊김으로 본다.
 * 전송 계층이 이미 AdbException을 던졌다면 그대로 둔다.
 */
function toWriteException(error: unknown): AdbException {
  if (error instanceof AdbException) return error;
  if (isTimeoutError(error)) {
    return new AdbTimeoutException('쓰기 시간 초과: 기기가 응답하지 않습니다.', error);
  }
  return new AdbConnectionClosedException('기기에 쓰는 중 연결이 끊겼습니다.', error);
}

function isTimeoutError(error: unknown): boolean {
  const code = (error as { code?: unknown } | undefined)?.code;
  return code === 'ETIMEDOUT' || code === 'LIBUSB_ERROR_TIMEOUT';
}
