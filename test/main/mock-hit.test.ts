// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import { ProxyEngine } from '../../src/main/proxy/proxy-engine';
import type { CaptureEvent } from '../../src/shared/capture';
import type { MockDefinition } from '../../src/shared/mock';

// 목 룰이 매칭된 요청에 대해 mock-hit 이벤트가 emit되는지 검증(통합).

let engine: ProxyEngine | undefined;

afterEach(async () => {
  if (engine) await engine.stop();
  engine = undefined;
});

function getViaProxy(proxyPort: number, targetUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const target = new URL(targetUrl);
    const req = http.request(
      { host: '127.0.0.1', port: proxyPort, method: 'GET', path: targetUrl, headers: { host: target.host } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      }
    );
    // 장애 주입(reset/close)은 소켓 에러로 끝난다.
    req.on('error', () => resolve(0));
    req.end();
  });
}

function mock(id: string, path: string, extra: Partial<MockDefinition> = {}): MockDefinition {
  return {
    id,
    label: id,
    method: 'GET',
    host: '',
    path,
    enabled: true,
    response: { status: 200, statusMessage: 'OK', headers: [], body: 'ok' },
    ...extra
  };
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('mock-hit 이벤트 (통합)', () => {
  it('매칭된 목 id로 mock-hit을 emit하고, 매칭 안 된 요청은 emit하지 않는다', async () => {
    const events: CaptureEvent[] = [];
    engine = new ProxyEngine((e) => events.push(e));
    const { port } = await engine.start(0);
    await engine.applyMocks(
      [mock('m-users', '/users'), mock('m-reset', '/boom', { fault: 'reset' })],
      'block'
    );

    expect(await getViaProxy(port!, 'http://api.example.com/users')).toBe(200);
    expect(await getViaProxy(port!, 'http://api.example.com/users')).toBe(200);
    await getViaProxy(port!, 'http://api.example.com/boom');
    expect(await getViaProxy(port!, 'http://api.example.com/other')).toBe(503);

    const hits = (): string[] =>
      events.flatMap((e) => (e.type === 'mock-hit' ? [e.mockId] : []));
    await waitFor(() => events.filter((e) => e.type === 'request').length >= 4);
    expect(hits().sort()).toEqual(['m-reset', 'm-users', 'm-users']);
  });

  it('호스트가 있는 목은 그 호스트의 요청에만 매칭되고, 비어 있으면 모든 호스트에 매칭된다', async () => {
    engine = new ProxyEngine(() => {});
    const { port } = await engine.start(0);
    await engine.applyMocks(
      [
        mock('m-a', '/user', { host: 'a.example.com', response: { status: 201, headers: [], body: 'a' } }),
        mock('m-b', '/user', { host: 'b.example.com', response: { status: 202, headers: [], body: 'b' } }),
        mock('m-any', '/ping')
      ],
      'block'
    );

    // 경로가 같아도 호스트마다 다른 목이 응답한다.
    expect(await getViaProxy(port!, 'http://a.example.com/user')).toBe(201);
    expect(await getViaProxy(port!, 'http://b.example.com/user')).toBe(202);
    // 목이 없는 호스트는 매칭되지 않는다.
    expect(await getViaProxy(port!, 'http://c.example.com/user')).toBe(503);
    // 호스트가 빈 목은 호스트를 가리지 않는다.
    expect(await getViaProxy(port!, 'http://c.example.com/ping')).toBe(200);
  });

  it('목을 해제하면 더 이상 mock-hit을 emit하지 않는다', async () => {
    const events: CaptureEvent[] = [];
    engine = new ProxyEngine((e) => events.push(e));
    const { port } = await engine.start(0);
    await engine.applyMocks([mock('m-users', '/users')], 'block');
    await engine.clearMocks();
    await engine.applyMocks([], 'block');

    expect(await getViaProxy(port!, 'http://api.example.com/users')).toBe(503);
    await waitFor(() => events.some((e) => e.type === 'request'));
    expect(events.some((e) => e.type === 'mock-hit')).toBe(false);
  });
});
