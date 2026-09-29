/**
 * Dadb 퍼사드: 기기 하나에 대한 ADB 연결을 필요할 때 만들고, 죽으면 다음 작업에서 다시 만든다.
 * dadb Dadb/DadbImpl 이식(Apache-2.0, NOTICE 참고).
 *
 * 서비스(셸/sync/설치/root/포워딩)는 services/에 AdbOpener 기반 함수로 두고, 여기서는 위임만 한다.
 * 결과 규약: 전송 실패는 AdbException throw, 작업 결과는 *Result 값으로 반환(results.ts).
 */

import type { AdbTransport } from './transport/transport';
import { TcpTransport } from './transport/tcp';
import { AdbConnection } from './protocol/connection';
import { AdbKeyPair } from './protocol/key-pair';
import type { AdbStream } from './protocol/stream';
import type { InstallResult, RootResult, SyncResult, UninstallResult } from './results';
import { abbExec, execCmd, type AdbOpener } from './services/opener';
import { openShell, shell, type AdbShellResponse, type AdbShellStream } from './services/shell';
import { openSync, pull, push, type AdbSyncStream, type ByteSink, type ByteSource } from './services/sync';
import { install, installMultiple, installStream, uninstall } from './services/install';
import { root, unroot, type RestartOptions } from './services/root';
import { tcpForward, type AdbTunnel } from './services/forward';
import {
  createReverseOpenHandler,
  killAllReverse,
  killReverse,
  listReverse,
  parseLocalTcpPort,
  reverseForward,
  type ReverseOptions,
  type ReverseRule
} from './services/reverse';
import { AdbOperationFailedException } from './results';

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

/** 설치된 reverse 규칙 핸들. */
export interface AdbReverse {
  /** 기기 쪽 사양(remote가 tcp:0이었다면 기기가 고른 실제 포트). */
  readonly remote: string;
  readonly local: string;
  /** 기기 쪽 포트. */
  readonly devicePort: number;
  /** 규칙 제거(멱등, 이미 사라졌어도 성공). */
  close(): Promise<void>;
}

export class Dadb implements AdbOpener {
  private connection: AdbConnection | undefined;
  /** 동시 호출이 연결을 두 번 만들지 않도록 진행 중인 연결 시도를 공유한다. */
  private connecting: Promise<AdbConnection> | undefined;
  private keyPair: Promise<AdbKeyPair | undefined> | undefined;
  /**
   * 우리가 설치한 reverse 규칙(remote → local). adbd는 연결이 끊기면 규칙을 지우므로,
   * 새 연결을 만들 때 다시 설치한다. 기기가 여는 스트림도 여기 있는 local 사양만 허용한다.
   */
  private readonly reverses = new Map<string, string>();

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

  // ---- 서비스 ----

  /** 명령 실행 → 출력/종료 코드. 0이 아닌 종료 코드도 값으로 돌려준다. */
  shell(command: string): Promise<AdbShellResponse> {
    return shell(this, command);
  }

  /** 셸 스트림(명령을 비우면 대화형). */
  openShell(command = ''): Promise<AdbShellStream> {
    return openShell(this, command);
  }

  /** 파일 경로 또는 바이트를 기기로. 경로면 파일 권한/수정 시각을 쓴다. */
  push(src: string | ByteSource, remotePath: string, mode?: number, lastModifiedMs?: number): Promise<SyncResult> {
    return push(this, src, remotePath, mode, lastModifiedMs);
  }

  /** 기기 파일을 로컬 경로 또는 청크 함수로. */
  pull(dst: string | ByteSink, remotePath: string): Promise<SyncResult> {
    return pull(this, dst, remotePath);
  }

  openSync(): Promise<AdbSyncStream> {
    return openSync(this);
  }

  install(apk: string | Uint8Array, ...options: string[]): Promise<InstallResult> {
    return install(this, apk, ...options);
  }

  installStream(source: ByteSource, size: number, ...options: string[]): Promise<InstallResult> {
    return installStream(this, source, size, ...options);
  }

  installMultiple(apks: string[], ...options: string[]): Promise<InstallResult> {
    return installMultiple(this, apks, ...options);
  }

  uninstall(packageName: string): Promise<UninstallResult> {
    return uninstall(this, packageName);
  }

  execCmd(...command: string[]): Promise<AdbStream> {
    return execCmd(this, ...command);
  }

  abbExec(...command: string[]): Promise<AdbStream> {
    return abbExec(this, ...command);
  }

  root(options?: RestartOptions): Promise<RootResult> {
    return root(this, options);
  }

  unroot(options?: RestartOptions): Promise<RootResult> {
    return unroot(this, options);
  }

  /** 호스트 127.0.0.1:hostPort → 기기 tcp:targetPort. hostPort 0이면 임의 포트. */
  tcpForward(hostPort: number, targetPort: number): Promise<AdbTunnel> {
    return tcpForward(this, hostPort, targetPort);
  }

  /**
   * 기기 remote 포트 → 호스트 local 포트(adb reverse). 예: reverse('tcp:8080', 'tcp:8080').
   * remote에 tcp:0을 주면 기기가 포트를 고른다. adbd가 거부하면 AdbOperationFailedException.
   *
   * 규칙은 ADB 연결에 묶여 있다. 연결이 끊기면 다음 작업에서 재연결할 때 다시 설치한다
   * (연결이 끊긴 뒤 아무 작업도 없으면 그동안은 동작하지 않는다).
   */
  async reverse(remote: string, local: string, options?: ReverseOptions): Promise<AdbReverse> {
    parseLocalTcpPort(local);
    const { devicePort } = await reverseForward(this, remote, local, options);
    const effectiveRemote = devicePort !== undefined ? `tcp:${devicePort}` : remote;
    this.reverses.set(effectiveRemote, local);
    let closed = false;
    return {
      remote: effectiveRemote,
      local,
      devicePort: devicePort ?? Number(/^tcp:(\d+)$/.exec(remote)?.[1] ?? NaN),
      close: async () => {
        if (closed) return;
        closed = true;
        await this.killReverse(effectiveRemote).catch((e) => {
          // 연결이 바뀌어 기기에서 이미 사라졌으면 성공으로 본다.
          if (!(e instanceof AdbOperationFailedException)) throw e;
        });
      }
    };
  }

  /** remote 규칙 하나를 제거한다(기기에 없으면 AdbOperationFailedException). */
  async killReverse(remote: string): Promise<void> {
    this.reverses.delete(remote);
    await killReverse(this, remote);
  }

  async killAllReverse(): Promise<void> {
    this.reverses.clear();
    await killAllReverse(this);
  }

  /** 기기에 설치된 reverse 규칙(다른 클라이언트가 만든 것 포함). */
  listReverse(): Promise<ReverseRule[]> {
    return listReverse(this);
  }

  // ---- 연결 ----

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
    connection.setOpenHandler(
      createReverseOpenHandler((destination) => [...this.reverses.values()].includes(destination))
    );
    await this.reapplyReverses(connection);
    this.connection = connection;
    return connection;
  }

  /**
   * 재연결 시 기존 reverse 규칙을 새 연결에 다시 설치한다.
   * this.connect()를 거치면 진행 중인 연결을 기다리며 교착되므로 연결을 직접 쓴다.
   * 실패한 규칙(기기 포트 사용 중 등)은 목록에 남겨 다음 재연결에서 다시 시도한다.
   */
  private async reapplyReverses(connection: AdbConnection): Promise<void> {
    if (this.reverses.size === 0) return;
    const opener: AdbOpener = {
      open: (destination) => connection.open(destination),
      supportsFeature: async (feature) => connection.supportsFeature(feature)
    };
    for (const [remote, local] of this.reverses) {
      await reverseForward(opener, remote, local).catch(() => undefined);
    }
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
