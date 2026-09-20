// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import { ProxyEngine } from '../../src/main/proxy/proxy-engine';
import type { CaptureEvent } from '../../src/shared/capture';

// 실제 mockttp 프록시를 띄우는 통합 테스트(Node 환경).
// ProxyEngine을 직접 테스트한다(런타임에는 ProxyService가 이 엔진을 워커에서 실행).

let backend: http.Server | undefined;
let service: ProxyEngine | undefined;

afterEach(async () => {
  if (service) await service.stop();
  service = undefined;
  if (backend) await new Promise<void>((r) => backend!.close(() => r()));
  backend = undefined;
});

/** 로컬 백엔드 HTTP 서버를 띄운다. */
function startBackend(): Promise<number> {
  return new Promise((resolve) => {
    backend = http.createServer((req, res) => {
      if (req.url === '/api/users') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([{ id: 1, name: 'Alice' }]));
      } else {
        res.writeHead(404);
        res.end('not found');
      }
    });
    backend.listen(0, () => {
      const address = backend!.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

/** 프록시를 경유해 요청을 보낸다. */
function requestViaProxy(proxyPort: number, targetUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const target = new URL(targetUrl);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: proxyPort,
        method: 'GET',
        path: targetUrl,
        headers: { host: target.host }
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve());
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('ProxyService (통합)', () => {
  it('프록시를 경유한 요청/응답을 캡처 이벤트로 방출한다', async () => {
    const backendPort = await startBackend();

    const events: CaptureEvent[] = [];
    service = new ProxyEngine((e) => events.push(e));

    const status = await service.start(0);
    expect(status.running).toBe(true);
    expect(status.port).toBeGreaterThan(0);

    await requestViaProxy(status.port!, `http://127.0.0.1:${backendPort}/api/users`);

    // 이벤트 전파를 잠깐 대기.
    await new Promise((r) => setTimeout(r, 200));

    const requestEvent = events.find((e) => e.type === 'request');
    const responseEvent = events.find((e) => e.type === 'response');

    expect(requestEvent).toBeDefined();
    expect(responseEvent).toBeDefined();

    if (requestEvent?.type === 'request') {
      expect(requestEvent.exchange.request.method).toBe('GET');
      expect(requestEvent.exchange.request.url).toContain('/api/users');
    }
    if (responseEvent?.type === 'response') {
      expect(responseEvent.response.statusCode).toBe(200);
      expect(responseEvent.response.body.encoding).toBe('text');
      expect(responseEvent.response.body.content).toContain('Alice');
    }
  }, 15_000);

  it('start는 idempotent하고 stop 후 상태가 초기화된다', async () => {
    service = new ProxyEngine(() => {});
    const s1 = await service.start(0);
    const s2 = await service.start(0);
    expect(s2.port).toBe(s1.port);

    const stopped = await service.stop();
    expect(stopped.running).toBe(false);
  }, 15_000);
});

function requestBody(proxyPort: number, targetUrl: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(targetUrl);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: proxyPort,
        method: 'GET',
        path: targetUrl,
        headers: { host: target.host }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('ProxyService 목킹 모드 (통합)', () => {
  it('목 적용 시 매칭 요청은 목 응답을 받고 백엔드 통과 안 함(완전 목킹)', async () => {
    // 백엔드가 있으면 절대 호출되면 안 됨을 검증하기 위해 백엔드 호출 여부를 추적.
    let backendHit = false;
    backend = http.createServer((_req, res) => {
      backendHit = true;
      res.writeHead(200);
      res.end('REAL BACKEND');
    });
    const backendPort = await new Promise<number>((resolve) => {
      backend!.listen(0, () => {
        const a = backend!.address();
        resolve(typeof a === 'object' && a ? a.port : 0);
      });
    });

    service = new ProxyEngine(() => {});
    const status = await service.start(0);

    await service.applyMocks(
      [
        {
          id: 'm1',
          label: 'mock',
          method: 'GET',
          path: '/mocked',
          response: { status: 202, headers: [['x-mock', 'yes']], body: 'MOCKED' },
          enabled: true
        }
      ],
      'passthrough'
    );

    const result = await requestBody(status.port!, `http://127.0.0.1:${backendPort}/mocked`);
    expect(result.status).toBe(202);
    expect(result.body).toBe('MOCKED');
    expect(backendHit).toBe(false); // 백엔드 호출 없음
  }, 15_000);

  it('block 정책: 매칭 안 된 요청은 503 차단', async () => {
    service = new ProxyEngine(() => {});
    const status = await service.start(0);
    await service.applyMocks([], 'block');

    const result = await requestBody(status.port!, 'http://nonexistent.example/x');
    expect(result.status).toBe(503);
  }, 15_000);

  it('지연(delayMs) 목: 응답이 지연 시간 이상 걸린다', async () => {
    service = new ProxyEngine(() => {});
    const status = await service.start(0);

    await service.applyMocks(
      [
        {
          id: 'd1',
          label: 'delayed',
          method: 'GET',
          path: '/slow',
          response: { status: 200, headers: [], body: 'OK' },
          enabled: true,
          delayMs: 400
        }
      ],
      'block'
    );

    const started = Date.now();
    const result = await requestBody(status.port!, 'http://x.example/slow');
    const elapsed = Date.now() - started;

    expect(result.status).toBe(200);
    expect(result.body).toBe('OK');
    expect(elapsed).toBeGreaterThanOrEqual(350); // 400ms 지연 반영(여유 둠)
  }, 15_000);

  it('fault=reset 목: 연결이 리셋되어 요청이 실패한다', async () => {
    service = new ProxyEngine(() => {});
    const status = await service.start(0);

    await service.applyMocks(
      [
        {
          id: 'r1',
          label: 'reset',
          method: 'GET',
          path: '/boom',
          response: { status: 200, headers: [], body: '' },
          enabled: true,
          fault: 'reset'
        }
      ],
      'block'
    );

    await expect(requestBody(status.port!, 'http://x.example/boom')).rejects.toThrow();
  }, 15_000);

  it('clearMocks 후 캡처 모드로 복귀(매칭 룰 없음 → passthrough)', async () => {
    backend = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('BACKEND');
    });
    const backendPort = await new Promise<number>((resolve) => {
      backend!.listen(0, () => {
        const a = backend!.address();
        resolve(typeof a === 'object' && a ? a.port : 0);
      });
    });

    service = new ProxyEngine(() => {});
    const status = await service.start(0);
    await service.applyMocks([], 'block');
    await service.clearMocks();

    const result = await requestBody(status.port!, `http://127.0.0.1:${backendPort}/anything`);
    expect(result.status).toBe(200);
    expect(result.body).toBe('BACKEND');
  }, 15_000);
});
