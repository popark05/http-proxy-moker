/**
 * main 프로세스 ↔ 프록시 워커(자식 프로세스) 간 메시지 프로토콜.
 *
 * mockttp의 업스트림 TLS는 Electron main(BoringSSL)에서 INVALID_COMMAND로 깨지므로,
 * 프록시 엔진을 순정 Node 자식 프로세스(ELECTRON_RUN_AS_NODE=1로 fork)에서 실행한다.
 * main은 명령(WorkerCommand)을 보내고, 워커는 응답/캡처 이벤트(WorkerMessage)를 돌려준다.
 *
 * 모든 메시지는 구조화 복제 가능한 순수 데이터여야 한다(process.send 제약).
 */

import type { CaptureEvent, ProxyStatus } from './capture';
import type { MockDefinition, UnmatchedPolicy } from './mock';

/** main → worker 명령. requestId로 응답을 매칭한다. */
export type WorkerCommand =
  | { kind: 'start'; requestId: number; port: number; caCertPath: string; caKeyPath: string }
  | { kind: 'stop'; requestId: number }
  | { kind: 'status'; requestId: number }
  | {
      kind: 'applyMocks';
      requestId: number;
      mocks: MockDefinition[];
      unmatchedPolicy: UnmatchedPolicy;
    }
  | { kind: 'clearMocks'; requestId: number };

/** worker → main 메시지. */
export type WorkerMessage =
  /** 명령 성공 응답. result는 명령에 따라 ProxyStatus 또는 void. */
  | { kind: 'result'; requestId: number; ok: true; status?: ProxyStatus }
  /** 명령 실패 응답. */
  | { kind: 'result'; requestId: number; ok: false; error: string }
  /** 비동기 캡처 이벤트 스트림(요청/응답/중단). */
  | { kind: 'capture'; event: CaptureEvent }
  /** 워커 준비 완료 신호. */
  | { kind: 'ready' };
