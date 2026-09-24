import { getLocal, type Mockttp, type MockedEndpoint } from 'mockttp';
import type { CaptureEvent, CapturedExchange, ProxyStatus } from '@shared/capture';
import type { MockDefinition, UnmatchedPolicy } from '@shared/mock';
import { mapRequest, mapResponse } from './capture-mapper';

export type EngineEmitter = (event: CaptureEvent) => void;

export interface EngineCa {
  cert: string;
  key: string;
}

/**
 * mockttp 프록시 엔진. 실제 프록시 시작/중지/룰 관리/캡처 구독을 담당한다.
 *
 * 이 클래스는 순정 Node에서 동작해야 한다(Electron main의 BoringSSL은 업스트림 TLS를
 * 깨뜨림). 따라서 프록시 워커(자식 프로세스)에서 인스턴스화되고, 앱 런타임에서는
 * ProxyService가 워커를 fork해 이 엔진을 원격 제어한다.
 *
 * 테스트에서는 순정 Node(vitest) 위에서 이 클래스를 직접 인스턴스화해 검증한다.
 */
export class ProxyEngine {
  private server: Mockttp | undefined;
  /** mockttp 룰 id → 목 id. 요청의 matchedRuleId로 어떤 목이 응답했는지 판별한다. */
  private ruleToMock = new Map<string, string>();

  constructor(
    private readonly emit: EngineEmitter,
    private readonly ca?: EngineCa
  ) {}

  getStatus(): ProxyStatus {
    return this.server ? { running: true, port: this.server.port } : { running: false };
  }

  async start(port: number): Promise<ProxyStatus> {
    if (this.server) return this.getStatus();
    const server = getLocal(this.ca ? { https: { cert: this.ca.cert, key: this.ca.key } } : undefined);
    await server.start(port);
    await this.registerCompanionEndpoints(server);
    await this.applyUnmatchedRule(server, 'passthrough');
    await this.subscribe(server);
    this.server = server;
    return this.getStatus();
  }

  async stop(): Promise<ProxyStatus> {
    if (this.server) {
      await this.server.stop();
      this.server = undefined;
      this.ruleToMock.clear();
    }
    return this.getStatus();
  }

  async applyMocks(mocks: MockDefinition[], unmatchedPolicy: UnmatchedPolicy): Promise<void> {
    if (!this.server) throw new Error('프록시가 실행 중이 아닙니다.');
    const server = this.server;
    await server.reset();
    this.ruleToMock.clear();
    await this.subscribe(server);
    await this.registerCompanionEndpoints(server);
    await this.registerMocks(server, mocks);
    await this.applyUnmatchedRule(server, unmatchedPolicy);
  }

  async clearMocks(): Promise<void> {
    if (!this.server) return;
    await this.server.reset();
    this.ruleToMock.clear();
    await this.subscribe(this.server);
    await this.registerCompanionEndpoints(this.server);
    await this.applyUnmatchedRule(this.server, 'passthrough');
  }

  /** companion VPN 앱이 프록시 신뢰를 검증할 때 요청하는 엔드포인트. */
  private async registerCompanionEndpoints(server: Mockttp): Promise<void> {
    if (!this.ca) return;
    const cert = this.ca.cert;
    await server
      .forGet('http://android.httptoolkit.tech/config')
      .thenJson(200, { certificate: cert, port: server.port });
    await server
      .forGet('http://amiusing.httptoolkit.tech/certificate')
      .thenReply(200, cert, { 'content-type': 'application/x-x509-ca-cert' });
  }

  private async applyUnmatchedRule(server: Mockttp, policy: UnmatchedPolicy): Promise<void> {
    if (policy === 'block') {
      await server.forUnmatchedRequest().thenReply(503, 'MokerProxy: no mock matched (완전 목킹 모드)');
    } else {
      await server.forUnmatchedRequest().thenPassThrough({ ignoreHostHttpsErrors: true });
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

  private async registerMocks(server: Mockttp, mocks: MockDefinition[]): Promise<void> {
    for (const mock of mocks) {
      if (!mock.enabled) continue;
      let builder = this.builderForMethod(server, mock.method, mock.path).always();
      if (mock.delayMs && mock.delayMs > 0) {
        builder = builder.delay(mock.delayMs);
      }
      let endpoint: MockedEndpoint;
      switch (mock.fault) {
        case 'timeout':
          endpoint = await builder.thenTimeout();
          break;
        case 'reset':
          endpoint = await builder.thenResetConnection();
          break;
        case 'close':
          endpoint = await builder.thenCloseConnection();
          break;
        default: {
          const headers = Object.fromEntries(mock.response.headers);
          endpoint = await builder.thenReply(mock.response.status, mock.response.body || undefined, headers);
        }
      }
      this.ruleToMock.set(endpoint.id, mock.id);
    }
  }

  private async subscribe(server: Mockttp): Promise<void> {
    await server.on('request', async (request) => {
      // 목 룰이 매칭된 요청이면 mock-hit을 알린다(장애 주입 목 포함). 캡처 변환 실패와 무관하게 먼저 emit.
      const mockId = request.matchedRuleId ? this.ruleToMock.get(request.matchedRuleId) : undefined;
      if (mockId) this.emit({ type: 'mock-hit', mockId, at: Date.now() });
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
