/**
 * 프록시 워커 진입점.
 *
 * Electron main 프로세스(BoringSSL)에서는 mockttp의 업스트림 TLS가 INVALID_COMMAND로
 * 깨지므로, 이 파일은 ELECTRON_RUN_AS_NODE=1 로 fork된 순정 Node 자식 프로세스에서 실행된다.
 * main과는 process.send / process.on('message') 로 통신한다(WorkerCommand/WorkerMessage).
 *
 * 실제 mockttp 로직은 ProxyEngine에 있다. 이 파일은 프로토콜(메시지 ↔ 엔진 호출) 어댑터다.
 */
import { promises as fs } from 'node:fs';
import type { CaptureEvent, ProxyStatus } from '@shared/capture';
import type { WorkerCommand, WorkerMessage } from '@shared/proxy-worker';
import { ProxyEngine, type EngineCa } from './proxy-engine';

let engine: ProxyEngine | undefined;

function send(message: WorkerMessage): void {
  process.send?.(message);
}

function emit(event: CaptureEvent): void {
  send({ kind: 'capture', event });
}

function status(): ProxyStatus {
  return engine ? engine.getStatus() : { running: false };
}

async function loadCa(certPath: string, keyPath: string): Promise<EngineCa | undefined> {
  if (!certPath || !keyPath) return undefined;
  const [cert, key] = await Promise.all([
    fs.readFile(certPath, 'utf-8'),
    fs.readFile(keyPath, 'utf-8')
  ]);
  return { cert, key };
}

async function handleCommand(cmd: WorkerCommand): Promise<void> {
  try {
    switch (cmd.kind) {
      case 'start': {
        if (!engine) {
          const ca = await loadCa(cmd.caCertPath, cmd.caKeyPath);
          engine = new ProxyEngine(emit, ca);
        }
        await engine.start(cmd.port);
        send({ kind: 'result', requestId: cmd.requestId, ok: true, status: status() });
        break;
      }
      case 'stop':
        if (engine) await engine.stop();
        send({ kind: 'result', requestId: cmd.requestId, ok: true, status: status() });
        break;
      case 'status':
        send({ kind: 'result', requestId: cmd.requestId, ok: true, status: status() });
        break;
      case 'applyMocks':
        if (!engine) throw new Error('프록시가 실행 중이 아닙니다.');
        await engine.applyMocks(cmd.mocks, cmd.unmatchedPolicy);
        send({ kind: 'result', requestId: cmd.requestId, ok: true });
        break;
      case 'clearMocks':
        if (engine) await engine.clearMocks();
        send({ kind: 'result', requestId: cmd.requestId, ok: true });
        break;
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    send({ kind: 'result', requestId: cmd.requestId, ok: false, error });
  }
}

process.on('message', (msg: WorkerCommand) => {
  void handleCommand(msg);
});

// 부모가 종료되면 프록시를 정리하고 함께 종료.
process.on('disconnect', () => {
  void (engine ? engine.stop() : Promise.resolve()).finally(() => process.exit(0));
});

send({ kind: 'ready' });
