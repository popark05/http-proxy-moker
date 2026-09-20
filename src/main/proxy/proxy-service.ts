import { getLocal, type Mockttp } from 'mockttp';
import type { CaptureEvent, ProxyStatus, CapturedExchange } from '@shared/capture';
import type { MockDefinition, UnmatchedPolicy } from '@shared/mock';
import { DEFAULT_PROXY_PORT } from '@shared/ipc';
import { mapRequest, mapResponse } from './capture-mapper';
import type { CaManager } from '../cert/ca-manager';

export type CaptureEmitter = (event: CaptureEvent) => void;

/**
 * mockttp 프록시의 라이프사이클과 캡처 이벤트 구독을 관리한다.
 * Task 3부터 CA를 주입해 HTTPS를 복호화한다. 목킹 룰 주입은 Task 8에서 추가.
 */
export class ProxyService {
  private server: Mockttp | undefined;
  private emit: CaptureEmitter;
  private ca: CaManager | undefined;

  constructor(emit: CaptureEmitter, ca?: CaManager) {
    this.emit = emit;
    this.ca = ca;
  }

  getStatus(): ProxyStatus {
    if (this.server) {
      return { running: true, port: this.server.port };
    }
    return { running: false };
  }

  async start(port: number = DEFAULT_PROXY_PORT): Promise<ProxyStatus> {
    if (this.server) return this.getStatus();

    // CA가 있으면 HTTPS 복호화를 위해 주입.
    const https = this.ca ? await this.ca.ensureCa() : undefined;

    const server = getLocal(https ? { https } : undefined);
    await server.start(port);

    // companion VPN 앱이 프록시를 신뢰하기 위해 요청하는 엔드포인트 처리.
    await this.registerCompanionEndpoints(server);
    // 시작 시엔 캡처 모드(모든 요청 passthrough).
    await this.applyUnmatchedRule(server, 'passthrough');

    await this.subscribe(server);
    this.server = server;
    return this.getStatus();
  }

  async stop(): Promise<ProxyStatus> {
    if (this.server) {
      await this.server.stop();
      this.server = undefined;
    }
    return this.getStatus();
  }

  /**
   * 목킹 모드 적용: 룰을 리셋하고 목 룰 + unmatched 정책을 설정한다.
   * 완전 목킹: 매칭 요청은 thenReply(로컬 응답, 업스트림 없음).
   */
  async applyMocks(mocks: MockDefinition[], unmatchedPolicy: UnmatchedPolicy): Promise<void> {
    if (!this.server) throw new Error('프록시가 실행 중이 아닙니다.');
    const server = this.server;

    // reset()은 룰과 함께 이벤트 리스너도 제거하므로, 재구독이 필요하다.
    await server.reset();
    await this.subscribe(server);
    await this.registerCompanionEndpoints(server);
    await this.registerMocks(server, mocks);
    await this.applyUnmatchedRule(server, unmatchedPolicy);
  }

  /** 캡처 모드로 복귀: 룰 초기화 + 재구독 + 모든 요청 passthrough. */
  async clearMocks(): Promise<void> {
    if (!this.server) return;
    await this.server.reset();
    await this.subscribe(this.server);
    await this.registerCompanionEndpoints(this.server);
    await this.applyUnmatchedRule(this.server, 'passthrough');
  }

  /**
   * 메서드별 빌더로 목 룰을 등록한다(완전 목킹).
   * 지연(delayMs)과 에러 주입(fault)을 반영한다.
   */
  private async registerMocks(server: Mockttp, mocks: MockDefinition[]): Promise<void> {
    for (const mock of mocks) {
      if (!mock.enabled) continue;

      let builder = this.builderForMethod(server, mock.method, mock.path).always();

      // 응답/에러 전에 지연을 삽입.
      if (mock.delayMs && mock.delayMs > 0) {
        builder = builder.delay(mock.delayMs);
      }

      // fault가 있으면 응답 대신 에러를 주입(완전 목킹, 백엔드 호출 없음).
      switch (mock.fault) {
        case 'timeout':
          await builder.thenTimeout();
          break;
        case 'reset':
          await builder.thenResetConnection();
          break;
        case 'close':
          await builder.thenCloseConnection();
          break;
        default: {
          const headers = Object.fromEntries(mock.response.headers);
          await builder.thenReply(
            mock.response.status,
            mock.response.body || undefined,
            headers
          );
        }
      }
    }
  }

  private builderForMethod(server: Mockttp, method: string, path: string) {
    switch (method.toUpperCase()) {
      case 'POST':
        return server.forPost(path);
      case 'PUT':
        return server.forPut(path);
      case 'DELETE':
        return server.forDelete(path);
      case 'PATCH':
        return server.forPatch(path);
      case 'HEAD':
        return server.forHead(path);
      case 'OPTIONS':
        return server.forOptions(path);
      default:
        return server.forGet(path);
    }
  }

  /**
   * companion VPN 앱이 프록시 신뢰를 검증할 때 요청하는 엔드포인트를 처리한다.
   * - GET http://android.httptoolkit.tech/config → { certificate, port } JSON
   * - GET http://amiusing.httptoolkit.tech/certificate → CA PEM 문자열
   * 앱은 받은 CA의 SPKI SHA-256 지문을 활성화 시 전달된 certFingerprint와 비교한다.
   */
  private async registerCompanionEndpoints(server: Mockttp): Promise<void> {
    if (!this.ca) return;
    const { cert } = await this.ca.ensureCa();

    await server
      .forGet('http://android.httptoolkit.tech/config')
      .thenJson(200, { certificate: cert, port: server.port });

    await server
      .forGet('http://amiusing.httptoolkit.tech/certificate')
      .thenReply(200, cert, { 'content-type': 'application/x-x509-ca-cert' });
  }

  private async applyUnmatchedRule(server: Mockttp, policy: UnmatchedPolicy): Promise<void> {
    if (policy === 'block') {
      await server
        .forUnmatchedRequest()
        .thenReply(503, 'MokerProxy: no mock matched (완전 목킹 모드)');
    } else {
      await server.forUnmatchedRequest().thenPassThrough({ ignoreHostHttpsErrors: true });
    }
  }

  private async subscribe(server: Mockttp): Promise<void> {
    await server.on('request', async (request) => {
      try {
        const mapped = await mapRequest(request);
        const exchange: CapturedExchange = {
          id: request.id,
          startedAt: request.timingEvents?.startTime ?? Date.now(),
          request: mapped
        };
        this.emit({ type: 'request', exchange });
      } catch {
        // 캡처 변환 실패는 조용히 무시(트래픽 흐름을 막지 않음).
      }
    });

    await server.on('response', async (response) => {
      try {
        const mapped = await mapResponse(response);
        this.emit({ type: 'response', id: response.id, response: mapped });
      } catch {
        // 무시
      }
    });

    await server.on('abort', (request) => {
      this.emit({ type: 'abort', id: request.id });
    });
  }
}
