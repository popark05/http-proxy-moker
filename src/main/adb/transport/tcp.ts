/**
 * TCP 전송(에뮬레이터 5555 포트, `adb tcpip`으로 연 기기). dadb DadbImpl의 소켓 처리 이식(Apache-2.0, NOTICE 참고).
 */

import * as net from 'node:net';
import type { AdbTransport } from './transport';
import { AdbConnectException, AdbTimeoutException } from '../errors';

export interface TcpTransportOptions {
  /** 연결 대기 시간(ms). 0이면 OS 기본값. */
  connectTimeoutMs?: number;
  /**
   * 쓰기 한 번이 OS 버퍼로 넘어가기까지의 기한(ms). 기본 10초.
   * adbd가 소켓을 비우지 않고 멈추면(wedge) 쓰기가 무한 대기하므로, 기한을 넘기면 소켓을 닫고
   * AdbTimeoutException을 던진다. 정상 연결에선 조각마다 수 ms 안에 끝나므로 조정할 값이 아니라
   * 정확성 보호 장치다(dadb WRITE_TIMEOUT_MILLIS와 동일한 의도).
   */
  writeTimeoutMs?: number;
  keepAlive?: boolean;
}

export const DEFAULT_WRITE_TIMEOUT = 10_000;

export class TcpTransport implements AdbTransport {
  private readonly closeListeners: Array<(error?: Error) => void> = [];
  private lastError: Error | undefined;

  private constructor(
    private readonly socket: net.Socket,
    private readonly writeTimeoutMs: number
  ) {
    socket.on('error', (e) => {
      this.lastError = e;
    });
    socket.on('close', () => {
      for (const listener of this.closeListeners) listener(this.lastError);
    });
  }

  /** host:port에 연결한다. 실패하면 AdbConnectException(아무것도 수립되지 않음 — 재시도 가능). */
  static connect(host: string, port: number, options: TcpTransportOptions = {}): Promise<TcpTransport> {
    return new Promise<TcpTransport>((resolve, reject) => {
      const socket = net.connect({ host, port });
      let timer: ReturnType<typeof setTimeout> | undefined;

      const fail = (cause: Error): void => {
        if (timer) clearTimeout(timer);
        socket.destroy();
        reject(new AdbConnectException(`${host}:${port}에 연결하지 못했습니다.`, cause));
      };

      socket.once('error', fail);
      if (options.connectTimeoutMs && options.connectTimeoutMs > 0) {
        timer = setTimeout(
          () => fail(new Error(`연결 시간 초과(${options.connectTimeoutMs}ms)`)),
          options.connectTimeoutMs
        );
      }
      socket.once('connect', () => {
        if (timer) clearTimeout(timer);
        socket.off('error', fail);
        socket.setNoDelay(true);
        if (options.keepAlive) socket.setKeepAlive(true);
        resolve(new TcpTransport(socket, options.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT));
      });
    });
  }

  write(data: Uint8Array): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.socket.destroyed) {
        reject(this.lastError ?? new Error('소켓이 닫혔습니다.'));
        return;
      }
      const timer =
        this.writeTimeoutMs > 0
          ? setTimeout(() => {
              const error = new AdbTimeoutException(
                `쓰기 시간 초과(${this.writeTimeoutMs}ms): 기기가 응답하지 않습니다.`
              );
              // 멈춘 연결은 되살릴 수 없으므로 닫는다 → 다음 작업에서 재연결.
              this.lastError = error;
              this.socket.destroy();
              reject(error);
            }, this.writeTimeoutMs)
          : undefined;
      // 콜백은 데이터가 OS로 넘어간 뒤(역압이 걸리면 비워질 때까지) 호출된다.
      this.socket.write(data, (err) => {
        if (timer) clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      });
    });
  }

  onData(listener: (chunk: Uint8Array) => void): void {
    this.socket.on('data', listener);
  }

  onClose(listener: (error?: Error) => void): void {
    if (this.socket.destroyed) {
      queueMicrotask(() => listener(this.lastError));
      return;
    }
    this.closeListeners.push(listener);
  }

  close(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.socket.destroyed) {
        resolve();
        return;
      }
      this.socket.once('close', () => resolve());
      this.socket.destroy();
    });
  }
}
