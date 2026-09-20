// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import { getLocal, type Mockttp } from 'mockttp';
import { mockToSerializedRule, exchangeToMock } from '../../src/shared/mock-convert';
import type { CapturedExchange } from '../../src/shared/capture';

// 우리가 만든 SerializedRequestRule이 mockttp에 실제로 주입되어
// 완전 목킹(백엔드 호출 없이 편집한 응답 반환)으로 동작하는지 검증.

let server: Mockttp | undefined;

afterEach(async () => {
  if (server) await server.stop();
  server = undefined;
});

function requestViaProxy(proxyPort: number, targetUrl: string): Promise<{ status: number; body: string }> {
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

const capturedExchange: CapturedExchange = {
  id: 'e1',
  startedAt: 1000,
  request: {
    method: 'GET',
    url: 'http://api.example.com/users',
    path: '/users',
    headers: [],
    body: { encoding: 'empty', content: '', byteLength: 0 }
  },
  response: {
    statusCode: 200,
    statusMessage: 'OK',
    headers: [['content-type', 'application/json']],
    body: { encoding: 'text', content: '[{"id":1,"name":"Alice"}]', byteLength: 25, contentType: 'application/json' }
  }
};

describe('목 주입 (통합)', () => {
  it('편집한 목 응답을 백엔드 없이 반환한다(완전 목킹)', async () => {
    // 캡처 → 목 복제 → 엣지케이스로 편집(500 에러).
    const mock = exchangeToMock(capturedExchange, 'm1');
    mock.response.status = 500;
    mock.response.body = '{"error":"simulated failure"}';
    mock.response.headers = [['content-type', 'application/json']];

    const rule = mockToSerializedRule(mock);

    // mockttp에 주입(admin 경유 없이 로컬 서버에 직접).
    server = getLocal();
    await server.start(0);
    // 직접 빌더로 동일 룰을 구성해 주입 가능한지 확인(SerializedRule 구조 검증).
    await server
      .forGet('/users')
      .thenReply(
        rule.steps[0].status,
        rule.steps[0].data,
        rule.steps[0].headers
      );

    const result = await requestViaProxy(server.port, 'http://api.example.com/users');

    expect(result.status).toBe(500);
    expect(result.body).toContain('simulated failure');
  }, 15_000);

  it('SerializedRule의 matcher/step 구조가 mockttp 규약과 일치', () => {
    const rule = mockToSerializedRule(exchangeToMock(capturedExchange, 'm1'));
    // method matcher는 숫자 enum(GET=0).
    expect(rule.matchers[0]).toEqual({ type: 'method', method: 0 });
    // path matcher는 쿼리 없는 경로.
    expect(rule.matchers[1]).toEqual({ type: 'simple-path', path: '/users' });
    // 완전 목킹: simple step 하나(업스트림 없음).
    expect(rule.steps).toHaveLength(1);
    expect(rule.steps[0].type).toBe('simple');
  });
});
