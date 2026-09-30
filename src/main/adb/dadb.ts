/**
 * Dadb 퍼사드: 기기 하나에 대한 ADB 연결을 필요할 때 만들고, 죽으면 다음 작업에서 다시 만든다.
 * dadb Dadb/DadbImpl 이식(Apache-2.0, NOTICE 참고).
 *
 * 서비스(셸/sync/설치/root/포워딩)는 services/에 AdbOpener 기반 함수로 두고, 여기서는 위임만 한다.
 * 결과 규약: 전송 실패는 AdbException throw, 작업 결과는 *Result 값으로 반환(results.ts).
 */

import type { AdbTransport } from './transport/transport';
import * as net from 'node:net';
import { TcpTransport } from './transport/tcp';
import { UsbTransport, type UsbTransportOptions } from './transport/usb';
import { findUsbAdbDevice, listUsbAdbDevices, type UsbBackend } from './transport/usb-discovery';
import { AdbConnection } from './protocol/connection';
import { AdbKeyPair } from './protocol/key-pair';
import type { AdbSession, AdbStreamLike } from './protocol/session';
import { AdbServerSession, listAdbServerDevices, type AdbServerOptions } from './transport/adb-server';
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
import { AdbConnectException, AdbUsbAccessException } from './errors';

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
  /** USB 전송 세부 설정(fromUsb/list에서 사용). */
  usb?: Omit<UsbTransportOptions, 'writeTimeoutMs'>;
  /**
   * USB를 직접 열 수 없을 때(adb server/Android Studio가 점유 등) 실행 중인 adb server를 경유할지.
   * 기본 true. 매 재연결마다 직접 연결을 먼저 시도한다.
   */
  adbServerFallback?: boolean;
  /** adb server 주소/포트(기본 127.0.0.1:ANDROID_ADB_SERVER_PORT|5037). */
  adbServer?: Omit<AdbServerOptions, 'readTimeoutMs' | 'writeTimeoutMs'>;
}

export interface DadbListOptions extends DadbOptions {
  /** USB 기기 포함(기본 true). */
  includeUsb?: boolean;
  /** 127.0.0.1의 에뮬레이터 adb 포트(5555~5585 홀수) 포함(기본 true). */
  includeEmulators?: boolean;
  /** 실행 중인 adb server에만 보이는 기기(adb connect한 무선 기기 등) 포함(기본 true). */
  includeAdbServer?: boolean;
  /** USB 백엔드(테스트용). 생략하면 `usb` 패키지. */
  usbBackend?: UsbBackend;
}

const MIN_EMULATOR_PORT = 5555;
const MAX_EMULATOR_PORT = 5585;

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
  private connection: AdbSession | undefined;
  /** 동시 호출이 연결을 두 번 만들지 않도록 진행 중인 연결 시도를 공유한다. */
  private connecting: Promise<AdbSession> | undefined;
  private keyPair: Promise<AdbKeyPair | undefined> | undefined;
  /**
   * 우리가 설치한 reverse 규칙(remote → local). adbd는 연결이 끊기면 규칙을 지우므로,
   * 새 연결을 만들 때 다시 설치한다. 기기가 여는 스트림도 여기 있는 local 사양만 허용한다.
   */
  private readonly reverses = new Map<string, string>();

  constructor(
    /** 기기 식별자(USB/adb server는 serial, 에뮬레이터는 emulator-<콘솔 포트>, TCP는 host:port). */
    readonly serial: string,
    /** 직접 연결 전송. 없으면 adb server 경유만 쓴다. */
    private readonly openTransport: (() => Promise<AdbTransport>) | undefined,
    private readonly options: DadbOptions = {},
    /** adb server에서 이 기기를 부르는 시리얼(대체/서버 전용 경로). */
    private readonly serverSerial?: string
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

  /**
   * USB로 직접 연결하는 Dadb(adb server 불필요). 연결할 때마다 시리얼로 기기를 다시 찾으므로
   * 케이블을 뽑았다 꽂아도 다음 작업에서 재연결된다.
   */
  static fromUsb(serial: string, options: DadbOptions & { usbBackend?: UsbBackend } = {}): Dadb {
    return new Dadb(
      serial,
      async () => {
        const device = await findUsbAdbDevice(serial, options.usbBackend);
        if (!device) throw new AdbConnectException(`USB 기기를 찾을 수 없습니다(serial=${serial}).`);
        return UsbTransport.open(device, { ...options.usb, writeTimeoutMs: options.writeTimeoutMs });
      },
      options,
      options.adbServerFallback === false ? undefined : serial
    );
  }

  /** 실행 중인 adb server를 경유하는 Dadb(adb connect한 무선 기기 등 서버에만 보이는 기기). */
  static fromAdbServer(serial: string, options: DadbOptions = {}): Dadb {
    return new Dadb(serial, undefined, options, serial);
  }

  /** 로컬 에뮬레이터(adb 포트 = 콘솔 포트 + 1). adb와 같은 이름 emulator-<콘솔 포트>를 쓴다. */
  static fromEmulator(adbPort: number, options: DadbOptions = {}): Dadb {
    return new Dadb(
      `emulator-${adbPort - 1}`,
      () =>
        TcpTransport.connect('127.0.0.1', adbPort, {
          connectTimeoutMs: options.connectTimeoutMs,
          writeTimeoutMs: options.writeTimeoutMs,
          keepAlive: options.keepAlive
        }),
      options
    );
  }

  /**
   * 연결 가능한 기기 목록: USB ADB 기기 + 로컬 에뮬레이터 + (실행 중이면) adb server에만 보이는 기기.
   * 연결(인증)은 하지 않는다 — 첫 작업에서 연결한다. USB 백엔드를 못 불러오거나 서버가 없으면 건너뛴다.
   * 같은 시리얼은 한 번만(USB 직접 > 에뮬레이터 > adb server 순으로 우선).
   */
  static async list(options: DadbListOptions = {}): Promise<Dadb[]> {
    const result: Dadb[] = [];
    if (options.includeUsb ?? true) {
      try {
        for (const info of await listUsbAdbDevices(options.usbBackend)) {
          result.push(Dadb.fromUsb(info.serial, options));
        }
      } catch {
        // USB 네이티브 모듈을 쓸 수 없는 환경: USB 기기 없이 진행.
      }
    }
    if (options.includeEmulators ?? true) {
      const ports: number[] = [];
      for (let port = MIN_EMULATOR_PORT; port <= MAX_EMULATOR_PORT; port += 2) ports.push(port);
      // localhost는 ::1을 먼저 시도할 수 있고, Windows는 닫힌 포트 거부가 느리므로 127.0.0.1로 직접 확인.
      const open = await Promise.all(ports.map((port) => isPortOpen('127.0.0.1', port, 1_000)));
      ports.forEach((port, i) => {
        if (open[i]) result.push(Dadb.fromEmulator(port, options));
      });
    }
    if (options.includeAdbServer ?? true) {
      try {
        const known = new Set(result.map((d) => d.serial));
        for (const device of await listAdbServerDevices(options.adbServer)) {
          if (!known.has(device.serial)) result.push(Dadb.fromAdbServer(device.serial, options));
        }
      } catch {
        // adb server가 실행 중이 아님.
      }
    }
    return result;
  }

  /** 첫 번째 기기(없으면 undefined). */
  static async discover(options: DadbListOptions = {}): Promise<Dadb | undefined> {
    return (await Dadb.list(options))[0];
  }

  async open(destination: string): Promise<AdbStreamLike> {
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

  execCmd(...command: string[]): Promise<AdbStreamLike> {
    return execCmd(this, ...command);
  }

  abbExec(...command: string[]): Promise<AdbStreamLike> {
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

  /** 현재 연결 방식(연결 전이면 undefined): direct = 우리가 직접 USB/TCP, server = adb server 경유. */
  get connectionKind(): 'direct' | 'server' | undefined {
    return this.connection && !this.connection.isClosed ? this.connection.kind : undefined;
  }

  /** 현재 연결(없거나 죽었으면 새로 만든다). */
  async connect(): Promise<AdbSession> {
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

  private async newConnection(): Promise<AdbSession> {
    const session = await this.openSession();
    await this.reapplyReverses(session);
    this.connection = session;
    return session;
  }

  /** 직접 연결을 먼저 시도하고, USB 점유 실패면 adb server 경유로 대체한다. */
  private async openSession(): Promise<AdbSession> {
    if (!this.openTransport) return this.openServerSession();
    try {
      const keyPair = await this.resolveKeyPair();
      const transport = await this.openTransport();
      const connection = await AdbConnection.connect(transport, {
        keyPair,
        authTimeoutMs: this.options.authTimeoutMs,
        readTimeoutMs: this.options.readTimeoutMs
      });
      // 기기가 여는 스트림(reverse)은 우리가 설치한 규칙의 목적지만 받는다.
      // (adb server 경유일 때는 서버가 직접 처리한다.)
      connection.setOpenHandler(
        createReverseOpenHandler((destination) => [...this.reverses.values()].includes(destination))
      );
      return connection;
    } catch (e) {
      if (!(e instanceof AdbUsbAccessException) || !this.serverSerial) throw e;
      // 서버가 없거나 서버에도 이 기기가 없으면 원래 오류(플랫폼별 안내 포함)를 알린다.
      return this.openServerSession().catch(() => {
        throw e;
      });
    }
  }

  private openServerSession(): Promise<AdbSession> {
    if (!this.serverSerial) throw new AdbConnectException('adb server 경로가 없는 기기입니다.');
    return AdbServerSession.connect(this.serverSerial, {
      ...this.options.adbServer,
      readTimeoutMs: this.options.readTimeoutMs,
      writeTimeoutMs: this.options.writeTimeoutMs
    });
  }

  /**
   * 재연결 시 기존 reverse 규칙을 새 연결에 다시 설치한다.
   * this.connect()를 거치면 진행 중인 연결을 기다리며 교착되므로 연결을 직접 쓴다.
   * 실패한 규칙(기기 포트 사용 중 등)은 목록에 남겨 다음 재연결에서 다시 시도한다.
   */
  private async reapplyReverses(connection: AdbSession): Promise<void> {
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

function isPortOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (open: boolean): void => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}
