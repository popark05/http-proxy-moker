// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import { describeNetworkError, runContract, runContracts } from '../../src/main/contract/contract-runner';
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

describe('runContract', () => {
  it('변수를 채워 실제로 보내고 통과를 보고한다', async () => {
    const baseUrl = await start();
    const r = await runContract(contract(), { baseUrl, vars: { authorization: 'Bearer t' } });
    expect(r).toMatchObject({ status: 'passed', httpStatus: 200, violations: [] });
    expect(seen[0]).toEqual({ method: 'GET', url: '/users?page=2', auth: 'Bearer t' });
  });

  it('응답 모양이 다르면 실패와 위반 경로를 보고한다', async () => {
    const baseUrl = await start();
    const c = contract({
      expect: { status: 200, headers: [], bodyShape: { kind: 'object', props: { id: { kind: 'string' } }, required: ['id'] } }
    });
    const r = await runContract(c, { baseUrl, vars: { authorization: 'x' } });
    expect(r.status).toBe('failed');
    expect(r.violations[0].path).toBe('$.id');
  });

  it('위험 메서드·검증 불가·변수 누락은 서버로 보내지 않고 건너뛴다', async () => {
    const baseUrl = await start();
    const post = contract({ safeToRun: false });
    post.request.method = 'POST';
    expect((await runContract(post, { baseUrl, vars: { authorization: 'x' } })).status).toBe('skipped');
    expect((await runContract(contract({ verifiable: false }), { baseUrl, vars: {} })).status).toBe('skipped');
    const missing = await runContract(contract(), { baseUrl, vars: {} });
    expect(missing).toMatchObject({ status: 'skipped', reason: '변수 값이 필요함: authorization' });
    expect(seen).toHaveLength(0);
  });

  it('allowUnsafe면 위험 메서드도 실행한다', async () => {
    const baseUrl = await start();
    const post = contract({ safeToRun: false });
    post.request.method = 'POST';
    const r = await runContract(post, { baseUrl, vars: { authorization: 'x' }, allowUnsafe: true });
    expect(r.status).toBe('passed');
    expect(seen[0].method).toBe('POST');
  });

  it('타임아웃과 연결 거부는 error로 보고한다', async () => {
    const baseUrl = await start();
    const slow = await runContract(contract({}, '/slow'), { baseUrl, vars: { authorization: 'x' }, timeoutMs: 100 });
    expect(slow).toMatchObject({ status: 'error', reason: '100ms 안에 응답이 없음(타임아웃)' });
    await new Promise<void>((r) => server!.close(() => r())); // 닫힌 포트로 연결 거부 재현
    const refused = await runContract(contract(), { baseUrl, vars: { authorization: 'x' } });
    expect(refused.status).toBe('error');
    expect(refused.reason).toContain('ECONNREFUSED');
  });
});

describe('서버 지정', () => {
  it('hostMap이 캡처한 서버보다 우선하고, 지정이 없으면 캡처한 서버로 보낸다', async () => {
    const baseUrl = await start();
    const mapped = await runContract(contract(), { hostMap: { 'http://127.0.0.1:9': baseUrl }, vars: { authorization: 'x' } });
    expect(mapped.status).toBe('passed');
    const own = contract();
    own.source = { capturedAt: 1, origin: baseUrl };
    expect((await runContract(own, { vars: { authorization: 'x' } })).status).toBe('passed');
  });

  it('캡처 출처가 없고 서버 지정도 없으면 건너뛴다', async () => {
    const c = contract();
    delete c.source;
    expect((await runContract(c, { vars: { authorization: 'x' } })).status).toBe('skipped');
  });
});

describe('runContracts', () => {
  it('입력 순서대로 결과를 돌려주고 하나씩 알린다', async () => {
    const baseUrl = await start();
    const notified: string[] = [];
    const list = ['/a', '/b', '/c'].map((p) => contract({}, p));
    const results = await runContracts(list, { baseUrl, vars: { authorization: 'x' }, concurrency: 2 }, (r) =>
      notified.push(r.contractName)
    );
    expect(results.map((r) => r.contractName)).toEqual(['GET /a', 'GET /b', 'GET /c']);
    expect(notified.sort()).toEqual(['GET /a', 'GET /b', 'GET /c']);
  });
});

describe('describeNetworkError', () => {
  it('SSL 인터셉션 오류는 NODE_EXTRA_CA_CERTS를 안내한다', () => {
    const msg = describeNetworkError({ cause: { code: 'SELF_SIGNED_CERT_IN_CHAIN' } }, 1000);
    expect(msg).toContain('NODE_EXTRA_CA_CERTS');
  });
});
