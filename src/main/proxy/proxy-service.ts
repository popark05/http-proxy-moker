import { fork, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { CaptureEvent, ProxyStatus } from '@shared/capture';
import type { MockDefinition, UnmatchedPolicy } from '@shared/mock';
import { DEFAULT_PROXY_PORT } from '@shared/ipc';
import type { WorkerCommand, WorkerMessage } from '@shared/proxy-worker';
import type { CaManager } from '../cert/ca-manager';

export type CaptureEmitter = (event: CaptureEvent) => void;

/** 워커가 준비되기까지 기다리는 최대 시간(ms). */
const WORKER_READY_TIMEOUT = 10_000;

/**
 * mockttp 프록시를 순정 Node 자식 프로세스(프록시 워커)에서 실행하고 제어한다.
 *
 * 배경: Electron main 프로세스는 BoringSSL을 쓰는데, mockttp가 업스트림으로 나가는
 * TLS 소켓이 BoringSSL에서 INVALID_COMMAND로 깨진다(HTTPS passthrough 시 500).
 * 그래서 프록시 엔진을 ELECTRON_RUN_AS_NODE=1 로 fork한 순정 Node 워커에서 실행한다.
 * (HTTP Toolkit 데스크탑도 프록시 서버를 별도 프로세스로 분리한다.)
 *
 * 이 클래스는 워커를 spawn하고 WorkerCommand를 보내 제어하며,
 * 워커가 보내는 캡처 이벤트를 emit으로 renderer에 중계한다. public API는 기존과 동일.
 */
export class ProxyService {
  private worker: ChildProcess | undefined;
  private readonly emit: CaptureEmitter;
  private readonly ca: CaManager | undefined;

  /** 워커 result 응답을 requestId로 매칭하기 위한 대기 맵. */
  private pending = new Map<
    number,
    { resolve: (status?: ProxyStatus) => void; reject: (err: Error) => void }
  >();
  private nextRequestId = 1;

  /** 동기 getStatus()를 위해 마지막으로 알려진 상태를 캐시. */
  private lastStatus: ProxyStatus = { running: false };

  constructor(emit: CaptureEmitter, ca?: CaManager) {
    this.emit = emit;
    this.ca = ca;
  }

  getStatus(): ProxyStatus {
    return this.lastStatus;
  }

  async start(port: number = DEFAULT_PROXY_PORT): Promise<ProxyStatus> {
    if (this.lastStatus.running) return this.lastStatus;

    const worker = await this.ensureWorker();

    // CA를 디스크에 보장하고 경로를 워커에 전달(워커가 직접 파일을 로드).
    let caCertPath = '';
    let caKeyPath = '';
    if (this.ca) {
      const paths = await this.ca.ensureCaPaths();
      caCertPath = paths.certPath;
      caKeyPath = paths.keyPath;
    }

    const status = await this.command(worker, (requestId) => ({
      kind: 'start',
      requestId,
      port,
      caCertPath,
      caKeyPath
    }));
    this.lastStatus = status ?? { running: true, port };
    return this.lastStatus;
  }

  async stop(): Promise<ProxyStatus> {
    if (!this.worker) {
      this.lastStatus = { running: false };
      return this.lastStatus;
    }
    const status = await this.command(this.worker, (requestId) => ({
      kind: 'stop',
      requestId
    }));
    this.lastStatus = status ?? { running: false };
    return this.lastStatus;
  }

  async applyMocks(mocks: MockDefinition[], unmatchedPolicy: UnmatchedPolicy): Promise<void> {
    const worker = this.requireWorker();
    await this.command(worker, (requestId) => ({
      kind: 'applyMocks',
      requestId,
      mocks,
      unmatchedPolicy
    }));
  }

  async clearMocks(): Promise<void> {
    if (!this.worker) return;
    await this.command(this.worker, (requestId) => ({
      kind: 'clearMocks',
      requestId
    }));
  }

  /** 워커 프로세스를 종료한다(앱 종료 시 정리용). */
  dispose(): void {
    if (this.worker) {
      this.worker.kill();
      this.worker = undefined;
    }
    this.lastStatus = { running: false };
  }

  private requireWorker(): ChildProcess {
    if (!this.worker) throw new Error('프록시 워커가 실행 중이 아닙니다.');
    return this.worker;
  }

  /** 워커를 spawn하고 ready 신호를 기다린다(이미 있으면 재사용). */
  private ensureWorker(): Promise<ChildProcess> {
    if (this.worker) return Promise.resolve(this.worker);

    // 워커 엔트리는 main 번들과 같은 디렉토리에 proxy-worker.js로 빌드된다.
    const workerPath = path.join(__dirname, 'proxy-worker.js');

    // 반드시 "시스템 Node"로 fork해야 한다.
    // Electron 바이너리는 ELECTRON_RUN_AS_NODE=1 로 실행해도 TLS 스택이 BoringSSL이라,
    // mockttp가 업스트림으로 나가는 HTTPS 소켓이 INVALID_COMMAND로 깨진다(HTTPS passthrough 500).
    // 시스템 Node(OpenSSL)로 fork하면 이 문제가 사라진다.
    const nodePath = resolveSystemNode();
    const worker = fork(workerPath, [], {
      execPath: nodePath,
      // Electron 바이너리를 fork할 때만 필요한 플래그지만, 시스템 Node에선 무해.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc']
    });

    worker.on('message', (msg: WorkerMessage) => this.onWorkerMessage(msg));
    worker.on('exit', () => {
      this.worker = undefined;
      this.lastStatus = { running: false };
      // 대기 중인 명령을 모두 실패 처리.
      for (const { reject } of this.pending.values()) {
        reject(new Error('프록시 워커가 종료되었습니다.'));
      }
      this.pending.clear();
    });

    this.worker = worker;

    return new Promise<ChildProcess>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('프록시 워커 시작 시간 초과'));
      }, WORKER_READY_TIMEOUT);

      const onReady = (msg: WorkerMessage): void => {
        if (msg.kind === 'ready') {
          cleanup();
          resolve(worker);
        }
      };
      const onExit = (): void => {
        cleanup();
        reject(new Error('프록시 워커가 시작 전에 종료되었습니다.'));
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        worker.off('message', onReady);
        worker.off('exit', onExit);
      };

      worker.on('message', onReady);
      worker.on('exit', onExit);
    });
  }

  private onWorkerMessage(msg: WorkerMessage): void {
    if (msg.kind === 'capture') {
      this.emit(msg.event);
      return;
    }
    if (msg.kind === 'result') {
      const entry = this.pending.get(msg.requestId);
      if (!entry) return;
      this.pending.delete(msg.requestId);
      if (msg.ok) {
        if (msg.status) this.lastStatus = msg.status;
        entry.resolve(msg.status);
      } else {
        entry.reject(new Error(msg.error));
      }
    }
    // 'ready'는 ensureWorker의 일회성 리스너가 처리.
  }

  /** 워커에 명령을 보내고 result 응답을 기다린다. */
  private command(
    worker: ChildProcess,
    build: (requestId: number) => WorkerCommand
  ): Promise<ProxyStatus | undefined> {
    const requestId = this.nextRequestId++;
    const cmd = build(requestId);
    return new Promise<ProxyStatus | undefined>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      worker.send(cmd, (err) => {
        if (err) {
          this.pending.delete(requestId);
          reject(err);
        }
      });
    });
  }
}

/**
 * 프록시 워커를 실행할 "시스템 Node" 바이너리 경로를 찾는다.
 * Electron 바이너리(BoringSSL)로는 mockttp 업스트림 TLS가 깨지므로 OpenSSL Node가 필요하다.
 *
 * 탐색 순서: NODE_BINARY_PATH 환경변수 → 흔한 설치 경로 → PATH의 `node`.
 * 내부 QA 도구 전제상 개발/사용 환경에 Node가 설치돼 있다고 가정한다.
 */
function resolveSystemNode(): string {
  const candidates = [
    process.env.NODE_BINARY_PATH,
    '/usr/local/bin/node',
    '/opt/homebrew/bin/node',
    '/usr/bin/node'
  ].filter((p): p is string => !!p);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // PATH에서 node를 찾는다(nvm/asdf 등 사용자 환경 대응).
  try {
    const found = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['node'], {
      encoding: 'utf-8'
    })
      .split('\n')[0]
      .trim();
    if (found && existsSync(found)) return found;
  } catch {
    // 무시하고 아래에서 에러.
  }

  throw new Error(
    '시스템 Node를 찾을 수 없습니다. 프록시 워커 실행에 Node가 필요합니다. ' +
      'NODE_BINARY_PATH 환경변수로 경로를 지정하세요.'
  );
}
