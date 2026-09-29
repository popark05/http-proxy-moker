/**
 * Dadb 퍼사드: 기기 하나에 대한 ADB 연결을 필요할 때 만들고, 죽으면 다음 작업에서 다시 만든다.
 * dadb Dadb/DadbImpl 이식(Apache-2.0, NOTICE 참고).
 *
 * 셸/sync/설치 같은 서비스는 이 클래스 위에 추가한다(A-3).
 */

import type { AdbTransport } from './transport/transport';
import { TcpTransport } from './transport/tcp';
import { AdbConnection } from './protocol/connection';
import { AdbKeyPair } from './protocol/key-pair';
import type { AdbStream } from './protocol/stream';

export interface DadbOptions {
  /**
   * 인증 키. 생략하면 ~/.android/adbkey(없으면 생성)를 쓴다(adb와 공유 → 이미 허용한 기기는 팝업 없음).
   * null이면 키 없이 연결(인증을 요구하지 않는 에뮬레이터 등).
   */
  keyPair?: AdbKeyPair | null;
  /** TCP 연결 대기(ms). */
  connectTimeoutMs?: number;
  /** 스트림 열기/읽기/쓰기 응답 대기(ms). 0이면 무제한. */
  readTimeoutMs?: number;
  /** 쓰기 정체 감지(ms). 기본 10초. */
  writeTimeoutMs?: number;
  /** 사용자의 "USB 디버깅 허용"을 기다리는 시간(ms). */
  authTimeoutMs?: number;
  keepAlive?: boolean;
}

export class Dadb {
  private connection: AdbConnection | undefined;
  /** 동시 호출이 연결을 두 번 만들지 않도록 진행 중인 연결 시도를 공유한다. */
  private connecting: Promise<AdbConnection> | undefined;
  private keyPair: Promise<AdbKeyPair | undefined> | undefined;

  constructor(
    /** 기기 식별자(TCP는 host:port, USB는 serial). */
    readonly serial: string,
    private readonly openTransport: () => Promise<AdbTransport>,
    private readonly options: DadbOptions = {}
  ) {}

  /** TCP로 adbd에 연결하는 Dadb(에뮬레이터는 콘솔 포트가 아니라 홀수 adb 포트, 예: 5555). */
  static create(host: string, port: number, options: DadbOptions = {}): Dadb {
    if (!Number.isInteger(port) || port < 0) throw new RangeError('port must be >= 0');
    return new Dadb(
      `${host}:${port}`,
      () =>
        TcpTransport.connect(host, port, {
          connectTimeoutMs: options.connectTimeoutMs,
          writeTimeoutMs: options.writeTimeoutMs,
          keepAlive: options.keepAlive
        }),
      options
    );
  }

  async open(destination: string): Promise<AdbStream> {
    return (await this.connect()).open(destination);
  }

  async supportsFeature(feature: string): Promise<boolean> {
    return (await this.connect()).supportsFeature(feature);
  }

  /** 현재 연결(없거나 죽었으면 새로 만든다). */
  async connect(): Promise<AdbConnection> {
    if (this.connection && !this.connection.isClosed) return this.connection;
    if (!this.connecting) {
      this.connecting = this.newConnection().finally(() => {
        this.connecting = undefined;
      });
    }
    return this.connecting;
  }

  async close(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    await connection?.close();
  }

  toString(): string {
    return this.serial;
  }

  private async newConnection(): Promise<AdbConnection> {
    const keyPair = await this.resolveKeyPair();
    const transport = await this.openTransport();
    const connection = await AdbConnection.connect(transport, {
      keyPair,
      authTimeoutMs: this.options.authTimeoutMs,
      readTimeoutMs: this.options.readTimeoutMs
    });
    this.connection = connection;
    return connection;
  }

  private resolveKeyPair(): Promise<AdbKeyPair | undefined> {
    if (!this.keyPair) {
      const { keyPair } = this.options;
      this.keyPair =
        keyPair === null
          ? Promise.resolve(undefined)
          : keyPair
            ? Promise.resolve(keyPair)
            : AdbKeyPair.readDefault();
      // 키 읽기 실패는 다음 시도에서 다시 읽도록 캐시하지 않는다.
      this.keyPair.catch(() => {
        this.keyPair = undefined;
      });
    }
    return this.keyPair;
  }
}
