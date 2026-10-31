import { describe, expect, it } from 'vitest';
import type { CapturedExchange } from '../../src/shared/capture';
import {
  applyVariables,
  checkResponse,
  exchangeToContract,
  inferShape,
  listVariables,
  mergeShapes,
  validateShape
} from '../../src/shared/contract';

function exchange(overrides: Partial<CapturedExchange['request']> = {}, res?: CapturedExchange['response']): CapturedExchange {
  return {
    id: 'e1',
    startedAt: 1000,
    request: {
      method: 'GET',
      url: 'https://api.example.com/v1/users?page=2',
      path: '/v1/users',
      headers: [
        ['Host', 'api.example.com'],
        ['Authorization', 'Bearer secret'],
        ['Accept', 'application/json']
      ],
      body: { encoding: 'empty', content: '', byteLength: 0 },
      ...overrides
    },
    response:
      res ??
      {
        statusCode: 200,
        statusMessage: 'OK',
        headers: [
          ['Content-Type', 'application/json'],
          ['Date', 'x']
        ],
        body: { encoding: 'text', content: '{"items":[{"id":1,"name":"a"}],"next":null}', byteLength: 10 }
      }
  };
}

describe('inferShape / validateShape', () => {
  it('객체·배열 모양을 추론하고 같은 모양은 통과한다', () => {
    const shape = inferShape({ items: [{ id: 1 }], ok: true });
    expect(validateShape({ items: [{ id: 99 }, { id: 2 }], ok: false }, shape)).toEqual([]);
  });

  it('필수 필드 누락과 타입 불일치를 경로와 함께 보고한다', () => {
    const shape = inferShape({ items: [{ id: 1, name: 'a' }] });
    const v = validateShape({ items: [{ id: 1, name: 'a' }, { id: '2' }] }, shape);
    expect(v).toEqual([
      { path: '$.items[1].name', message: '필수 필드가 없음' },
      { path: '$.items[1].id', message: '숫자여야 함 (실제: 문자열)' }
    ]);
  });

  it('여러 샘플을 합치면 한쪽에만 있는 필드가 선택 필드가 된다', () => {
    const merged = mergeShapes(inferShape({ a: 1, b: 2 }), inferShape({ a: 1 }));
    expect(validateShape({ a: 5 }, merged)).toEqual([]);
    expect(validateShape({ b: 1 }, merged)).toEqual([{ path: '$.a', message: '필수 필드가 없음' }]);
  });

  it('null 허용은 union으로 표현된다', () => {
    const merged = mergeShapes(inferShape({ n: null }), inferShape({ n: 'x' }));
    expect(validateShape({ n: 'y' }, merged)).toEqual([]);
    expect(validateShape({ n: null }, merged)).toEqual([]);
    expect(validateShape({ n: 3 }, merged)).toHaveLength(1);
  });

  it('빈 배열은 원소 모양을 제한하지 않는다', () => {
    expect(validateShape([1, 'a'], inferShape([]))).toEqual([]);
  });
});

describe('변수 치환', () => {
  it('치환하고 없는 변수는 missing으로 돌려준다', () => {
    expect(applyVariables('{{baseUrl}}/x?t={{token}}', { baseUrl: 'https://dev' })).toEqual({
      text: 'https://dev/x?t={{token}}',
      missing: ['token']
    });
  });

  it('사용된 변수 이름을 중복 없이 나열한다', () => {
    expect(listVariables('{{a}} {{b}} {{a}}')).toEqual(['a', 'b']);
  });
});

describe('exchangeToContract', () => {
  it('서버 주소와 인증 값을 변수로 치환하고 불필요한 헤더를 뺀다', () => {
    const c = exchangeToContract(exchange(), 'c1')!;
    expect(c.endpointId).toBe('GET /v1/users');
    expect(c.request.urlTemplate).toBe('{{baseUrl}}/v1/users');
    expect(c.request.query).toEqual([['page', '2']]);
    expect(c.request.headers).toEqual([
      ['Authorization', '{{authorization}}'],
      ['Accept', 'application/json']
    ]);
    expect(JSON.stringify(c)).not.toContain('secret');
    expect(c.expect.headers).toEqual(['content-type']);
    expect(c.safeToRun).toBe(true);
    expect(c.verifiable).toBe(true);
  });

  it('POST는 안전하지 않고 5xx 응답은 검증 불가로 표시한다', () => {
    const c = exchangeToContract(
      exchange(
        { method: 'POST' },
        { statusCode: 500, statusMessage: '', headers: [], body: { encoding: 'empty', content: '', byteLength: 0 } }
      ),
      'c2'
    )!;
    expect(c.safeToRun).toBe(false);
    expect(c.verifiable).toBe(false);
    expect(c.expect.bodyShape).toBeUndefined();
  });

  it('응답이 없거나 중단되면 null', () => {
    expect(exchangeToContract({ ...exchange(), response: undefined }, 'c3')).toBeNull();
    expect(exchangeToContract(exchange({}, 'aborted'), 'c4')).toBeNull();
  });
});

describe('checkResponse', () => {
  const contract = exchangeToContract(exchange(), 'c1')!;

  it('같은 모양의 응답은 통과한다', () => {
    const r = checkResponse(contract.expect, {
      status: 200,
      headers: [['Content-Type', 'application/json']],
      body: '{"items":[],"next":"abc"}'
    });
    expect(r.passed).toBe(false); // next: null → string 은 모양이 다르다
    expect(r.violations[0].path).toBe('$.next');
  });

  it('상태·헤더·본문 위반을 모두 모은다', () => {
    const r = checkResponse(contract.expect, { status: 404, headers: [], body: 'oops' });
    expect(r.violations.map((v) => v.path)).toEqual(['status', 'headers.content-type', '$']);
  });

  it('통과 케이스', () => {
    const r = checkResponse(contract.expect, {
      status: 200,
      headers: [['content-type', 'application/json']],
      body: '{"items":[{"id":3,"name":"z"}],"next":null}'
    });
    expect(r).toEqual({ passed: true, violations: [] });
  });
});

import {
  looksLikeProduction,
  normalizeBaseUrl,
  planRequest,
  requiredVariables,
  summarizeRun,
  uniqueContractName
} from '../../src/shared/contract';

describe('서버/폼 보조', () => {
  it('서버 주소를 정규화하고 잘못된 주소는 거절한다', () => {
    expect(normalizeBaseUrl(' https://dev.example.com/ ')).toBe('https://dev.example.com');
    expect(normalizeBaseUrl('http://10.0.0.1:8080/api/')).toBe('http://10.0.0.1:8080/api');
    expect(normalizeBaseUrl('ftp://x')).toBeNull();
    expect(normalizeBaseUrl('dev.example.com')).toBeNull();
  });

  it('운영 서버로 보이는 이름·주소를 알아본다', () => {
    expect(looksLikeProduction({ name: 'prod', baseUrl: 'https://a.com' })).toBe(true);
    expect(looksLikeProduction({ name: '운영', baseUrl: 'https://a.com' })).toBe(true);
    expect(looksLikeProduction({ name: 'dev', baseUrl: 'https://api-prd.a.com' })).toBe(true);
    expect(looksLikeProduction({ name: 'staging', baseUrl: 'https://stg.a.com' })).toBe(false);
    expect(looksLikeProduction({ name: 'product-dev', baseUrl: 'https://dev.a.com' })).toBe(false);
  });

  it('겹치지 않는 계약 이름을 만든다', () => {
    expect(uniqueContractName(['GET /a'], 'GET /a')).toBe('GET /a (2)');
    expect(uniqueContractName(['GET /a', 'get /a (2)'], 'GET /a')).toBe('GET /a (3)');
    expect(uniqueContractName([], 'x')).toBe('x');
  });

  it('실행 시 입력할 변수만 모은다(baseUrl 제외)', () => {
    const c = exchangeToContract(exchange(), 'c')!;
    expect(requiredVariables([c])).toEqual(['authorization']);
  });

  it('planRequest가 쿼리를 붙이고 변수를 채운다', () => {
    const c = exchangeToContract(exchange(), 'c')!;
    const plan = planRequest(c, { baseUrl: 'https://dev.example.com/', vars: { authorization: 'Bearer t' } });
    expect(plan).toMatchObject({
      ok: true,
      request: { url: 'https://dev.example.com/v1/users?page=2', headers: [['Authorization', 'Bearer t'], ['Accept', 'application/json']] }
    });
  });

  it('결과 개수를 센다', () => {
    const base = { contractName: 'a', endpointId: 'GET /a', violations: [] };
    expect(summarizeRun([{ ...base, status: 'passed' }, { ...base, status: 'failed' }, { ...base, status: 'passed' }])).toEqual({
      passed: 2,
      failed: 1,
      skipped: 0,
      error: 0
    });
  });
});

describe('캡처한 서버(origin)', () => {
  it('계약에 캡처한 origin을 담고 목록으로 모은다', async () => {
    const { contractOrigins } = await import('../../src/shared/contract');
    const c = exchangeToContract(exchange(), 'c')!;
    expect(c.source?.origin).toBe('https://api.example.com');
    expect(contractOrigins([c, c])).toEqual(['https://api.example.com']);
  });
});

import { listShapeFields, maskRequestBody, mergeContractSample, sameRequest } from '../../src/shared/contract';

describe('민감 값 마스킹', () => {
  it('요청 본문의 민감 키(중첩 포함)와 쿼리 값을 변수로 바꾼다', () => {
    const c = exchangeToContract(
      exchange({
        method: 'POST',
        url: 'https://api.example.com/login?access_token=abc&page=1',
        body: {
          encoding: 'text',
          content: JSON.stringify({ userId: 'u1', password: 'pw1234', profile: { phone: '010-1234-5678', age: 30 } }),
          byteLength: 10,
          contentType: 'application/json'
        }
      }),
      'c'
    )!;
    expect(c.request.query).toEqual([['access_token', '{{access_token}}'], ['page', '1']]);
    expect(JSON.parse(c.request.body!.content)).toEqual({
      userId: 'u1',
      password: '{{password}}',
      profile: { phone: '{{phone}}', age: 30 }
    });
    const dump = JSON.stringify(c);
    for (const secret of ['pw1234', '010-1234-5678', 'abc']) expect(dump).not.toContain(secret);
    expect(requiredVariables([c]).sort()).toEqual(['access_token', 'authorization', 'password', 'phone']);
  });

  it('폼 인코딩 본문도 가린다', () => {
    expect(maskRequestBody('id=a&password=zzz', 'application/x-www-form-urlencoded')).toBe('id=a&password={{password}}');
  });
});

describe('필드 규칙', () => {
  const shape = inferShape({ items: [{ id: 1, at: 'x' }], code: 'OK' });

  it('무시 규칙은 해당 필드의 누락·타입 불일치를 허용한다', () => {
    const rules = { '$.items[].at': { mode: 'ignore' as const } };
    expect(validateShape({ items: [{ id: 1 }], code: 'OK' }, shape, '$', rules)).toEqual([]);
    expect(validateShape({ items: [{ id: 1, at: 5 }], code: 'OK' }, shape, '$', rules)).toEqual([]);
  });

  it('값 일치 규칙은 값까지 비교한다', () => {
    const rules = { '$.code': { mode: 'equals' as const, value: 'OK' } };
    expect(validateShape({ items: [], code: 'OK' }, shape, '$', rules)).toEqual([]);
    expect(validateShape({ items: [], code: 'FAIL' }, shape, '$', rules)).toEqual([
      { path: '$.code', message: '"OK"이어야 함 (실제: "FAIL")' }
    ]);
  });

  it('checkResponse가 계약의 fieldRules를 적용한다', () => {
    const c = exchangeToContract(exchange(), 'c')!;
    c.expect.fieldRules = { '$.items[].name': { mode: 'ignore' } };
    const r = checkResponse(c.expect, {
      status: 200,
      headers: [['content-type', 'x']],
      body: '{"items":[{"id":1}],"next":null}'
    });
    expect(r.passed).toBe(true);
  });

  it('모양을 필드 목록으로 펼친다', () => {
    expect(listShapeFields(shape).map((f) => f.path)).toEqual(['$.items', '$.items[]', '$.items[].id', '$.items[].at', '$.code']);
  });
});

describe('같은 요청 합치기', () => {
  it('같은 요청은 모양을 합치고 기대 헤더는 공통분만 남긴다', () => {
    const a = exchangeToContract(exchange(), 'a')!;
    const b = exchangeToContract(
      exchange({}, {
        statusCode: 200,
        statusMessage: 'OK',
        headers: [['Content-Type', 'x'], ['X-Extra', '1']],
        body: { encoding: 'text', content: '{"items":[{"id":2}],"next":"n"}', byteLength: 1 }
      }),
      'b'
    )!;
    expect(sameRequest(a, b)).toBe(true);
    const merged = mergeContractSample(a, b);
    expect(merged.expect.headers).toEqual(['content-type']);
    expect(validateShape({ items: [{ id: 1 }], next: 'z' }, merged.expect.bodyShape!)).toEqual([]);
    expect(validateShape({ items: [{ id: 1 }] }, merged.expect.bodyShape!)).toHaveLength(1);
  });
});

describe('contractsFromExchanges', () => {
  it('같은 요청은 합치고 응답 없는 것은 센다', async () => {
    const { contractsFromExchanges } = await import('../../src/shared/contract');
    let n = 0;
    const r = contractsFromExchanges([exchange(), exchange(), { ...exchange(), response: undefined }], () => `i${n++}`);
    expect(r.contracts).toHaveLength(1);
    expect(r.skipped).toBe(1);
  });
});
