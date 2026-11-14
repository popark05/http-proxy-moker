// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import { describeNetworkError, sendRequest } from '../../src/main/contract/contract-runner';
import type { Contract } from '../../src/shared/contract';

let server: http.Server | undefined;
const seen: Array<{ method?: string; url?: string; auth?: string }> = [];

afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
  seen.length = 0;
});

async function start(): Promise<string> {
  server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    if (req.url?.startsWith('/slow')) return; // 응답하지 않음
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 1, name: 'a' }));
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
  return `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
}

function contract(over: Partial<Contract> = {}, path = '/users'): Contract {
  return {
    version: 1,
    id: 'c',
    endpointId: `GET ${path}`,
    name: `GET ${path}`,
    request: {
      method: 'GET',
      urlTemplate: `{{baseUrl}}${path}`,
      query: [['page', '2']],
      headers: [['Authorization', '{{authorization}}']]
    },
    expect: {
      status: 200,
      headers: ['content-type'],
      bodyShape: { kind: 'object', props: { id: { kind: 'number' }, name: { kind: 'string' } }, required: ['id', 'name'] }
    },
    verifiable: true,
    safeToRun: true,
    source: { capturedAt: 1, origin: 'http://127.0.0.1:9' },
    ...over
  };
}

describe('sendRequest (컬렉션 Send)', () => {
  it('변수를 채워 실제로 보내고 응답을 그대로 돌려준다(상태/헤더/본문/시간)', async () => {
    const baseUrl = await start();
    const r = await sendRequest(contract(), { baseUrl, vars: { authorization: 'Bearer t' } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ status: 200, method: 'GET', bodyEncoding: 'text', truncated: false, omittedHeaders: [] });
    expect(r.url).toBe(`${baseUrl}/users?page=2`);
    expect(JSON.parse(r.body)).toEqual({ id: 1, name: 'a' });
    expect(r.headers.some(([n]) => n === 'content-type')).toBe(true);
    expect(r.sizeBytes).toBeGreaterThan(0);
    expect(seen[0]).toEqual({ method: 'GET', url: '/users?page=2', auth: 'Bearer t' });
  });

  it('값이 비어 있는 변수 헤더는 건너뛰지 않고 헤더만 빼서 보낸다', async () => {
    const baseUrl = await start();
    const r = await sendRequest(contract(), { baseUrl, vars: {} });
    expect(r).toMatchObject({ ok: true, omittedHeaders: ['Authorization'] });
    expect(seen[0].auth).toBeUndefined();
  });

  it('재현 불가/위험 메서드 표시가 있어도 직접 보낸 요청은 보낸다', async () => {
    const baseUrl = await start();
    const r = await sendRequest(
      contract({ verifiable: false, safeToRun: false, request: { method: 'POST', urlTemplate: '{{baseUrl}}/x', query: [], headers: [] } }),
      { baseUrl, vars: {} }
    );
    expect(r.ok && r.status).toBe(200);
    expect(seen[0].method).toBe('POST');
  });

  it('주소·쿼리·본문의 변수가 비어 있으면 보내지 않고 이유를 알려 준다', async () => {
    const baseUrl = await start();
    const c = contract();
    c.request.query = [['t', '{{token}}']];
    expect(await sendRequest(c, { baseUrl, vars: {} })).toEqual({ ok: false, error: '변수 값이 필요함: token' });
    const missing = await sendRequest(
      contract({ request: { method: 'GET', urlTemplate: '{{baseUrl}}/{{id}}', query: [], headers: [] } }),
      { baseUrl, vars: {} }
    );
    expect(missing).toMatchObject({ ok: false, error: expect.stringContaining('id') });
    expect(seen).toHaveLength(0);
  });

  it('hostMap이 캡처한 서버보다 우선하고, 지정이 없으면 캡처한 서버로 보낸다', async () => {
    const baseUrl = await start();
    const mapped = await sendRequest(contract(), { hostMap: { 'http://127.0.0.1:9': baseUrl }, vars: { authorization: 'x' } });
    expect(mapped.ok).toBe(true);
    const own = contract();
    own.source = { capturedAt: 1, origin: baseUrl };
    expect((await sendRequest(own, { vars: { authorization: 'x' } })).ok).toBe(true);
  });

  it('캡처 출처가 없고 서버 지정도 없으면 이유를 알려 준다', async () => {
    const c = contract();
    delete c.source;
    expect(await sendRequest(c, { vars: { authorization: 'x' } })).toMatchObject({ ok: false, error: expect.stringContaining('서버') });
  });

  it('타임아웃과 연결 거부는 오류로 돌려준다', async () => {
    const baseUrl = await start();
    const slow = await sendRequest(contract({}, '/slow'), { baseUrl, vars: { authorization: 'x' }, timeoutMs: 100 });
    expect(slow).toEqual({ ok: false, error: '100ms 안에 응답이 없음(타임아웃)' });
    await new Promise<void>((r) => server!.close(() => r())); // 닫힌 포트로 연결 거부 재현
    const refused = await sendRequest(contract(), { baseUrl, vars: { authorization: 'x' } });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toContain('ECONNREFUSED');
  });
});

describe('describeNetworkError', () => {
  it('SSL 인터셉션 오류는 NODE_EXTRA_CA_CERTS를 안내한다', () => {
    const msg = describeNetworkError({ cause: { code: 'SELF_SIGNED_CERT_IN_CHAIN' } }, 1000);
    expect(msg).toContain('NODE_EXTRA_CA_CERTS');
  });
});
