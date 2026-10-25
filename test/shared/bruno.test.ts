import { describe, expect, it } from 'vitest';
import {
  brunoToContract,
  buildBrunoShapeChecker,
  exportBrunoCollection,
  parseBruBlocks
} from '../../src/shared/bruno';
import { inferShape, validateShape, type Contract } from '../../src/shared/contract';

const contract: Contract = {
  version: 1,
  id: 'c1',
  endpointId: 'POST /v1/login',
  name: 'POST /v1/login',
  source: { capturedAt: 1, origin: 'https://api.example.com' },
  request: {
    method: 'POST',
    urlTemplate: '{{baseUrl}}/v1/login',
    query: [['lang', 'ko']],
    headers: [['Authorization', '{{authorization}}'], ['Accept', 'application/json']],
    body: { encoding: 'text', content: '{"id":"u1","password":"{{password}}"}', contentType: 'application/json' }
  },
  expect: {
    status: 200,
    headers: ['content-type'],
    bodyShape: inferShape({ token: 'x', user: { id: 1, tags: ['a'] }, at: 'now' }),
    fieldRules: { '$.at': { mode: 'ignore' }, '$.user.id': { mode: 'equals', value: 1 } }
  },
  verifiable: true,
  safeToRun: false
};

describe('exportBrunoCollection', () => {
  const files = exportBrunoCollection('QA', [contract], [{ name: 'dev', baseUrl: 'https://dev.example.com' }]);
  const byPath = Object.fromEntries(files.map((f) => [f.path, f.content]));

  it('컬렉션·요청·환경 파일을 만든다', () => {
    expect(Object.keys(byPath).sort()).toEqual([
      'api.example.com/POST _v1_login.bru',
      'bruno.json',
      'environments/captured-api_example_com.bru',
      'environments/dev.bru'
    ]);
    expect(JSON.parse(byPath['bruno.json'])).toEqual({ version: '1', name: 'QA', type: 'collection' });
  });

  it('요청 .bru에 주소·헤더·본문·assert가 들어간다', () => {
    const bru = byPath['api.example.com/POST _v1_login.bru'];
    expect(bru).toContain('post {\n  url: {{baseUrl}}/v1/login\n  body: json');
    expect(bru).toContain('params:query {\n  lang: ko\n}');
    expect(bru).toContain('  Authorization: {{authorization}}');
    expect(bru).toContain('body:json {');
    expect(bru).toContain('assert {\n  res.status: eq 200\n}');
    expect(bru).toContain('tests {');
  });

  it('환경 파일은 값 없이 변수 이름만 secret으로 선언한다', () => {
    expect(byPath['environments/dev.bru']).toBe(
      'vars {\n  baseUrl: https://dev.example.com\n}\n\nvars:secret [\n  authorization,\n  password\n]\n'
    );
  });
});

describe('가져오기', () => {
  it('우리가 내보낸 파일은 그대로 복원된다', () => {
    const [, bru] = exportBrunoCollection('QA', [contract], []).map((f) => f.content);
    const { contract: back, notes } = brunoToContract(bru, 'fallback', 'new');
    expect(notes).toEqual([]);
    expect(back).toMatchObject({
      endpointId: 'POST /v1/login',
      name: 'POST /v1/login',
      request: { method: 'POST', urlTemplate: '{{baseUrl}}/v1/login', query: [['lang', 'ko']] },
      expect: contract.expect,
      safeToRun: false
    });
    expect(back!.request.headers).toEqual(contract.request.headers);
    expect(JSON.parse(back!.request.body!.content)).toEqual({ id: 'u1', password: '{{password}}' });
  });

  it('직접 만든 .bru에서 주소, 쿼리, 상태, 타입 assert를 읽는다', () => {
    const bru = `meta {
  name: 사용자 조회
  type: http
  seq: 1
}

get {
  url: https://api.example.com/v1/users?page=2
  body: none
  auth: none
}

headers {
  Accept: application/json
  ~X-Off: 1
}

assert {
  res.status: eq 200
  res.body.id: isNumber
  res.body.profile.name: isString
  res.body.items[0].id: eq 1
}

tests {
  test("x", function () {});
}
`;
    const { contract: c, notes } = brunoToContract(bru, 'f', 'id');
    expect(c).toMatchObject({
      name: '사용자 조회',
      endpointId: 'GET /v1/users',
      source: { origin: 'https://api.example.com' },
      request: { urlTemplate: '{{baseUrl}}/v1/users', query: [['page', '2']], headers: [['Accept', 'application/json']] },
      expect: { status: 200 },
      safeToRun: true
    });
    expect(validateShape({ id: 1, profile: { name: 'a' } }, c!.expect.bodyShape!)).toEqual([]);
    expect(validateShape({ id: '1', profile: { name: 'a' } }, c!.expect.bodyShape!)).toHaveLength(1);
    expect(notes).toEqual(['지원하지 않는 assert 1개 제외', 'tests 스크립트는 가져오지 않음']);
  });

  it('{{host}} 같은 환경 변수는 {{baseUrl}}로 통일하고, 요청이 아닌 파일은 건너뛴다', () => {
    const { contract: c } = brunoToContract('get {\n  url: {{host}}/ping\n}\n', 'ping', 'i');
    expect(c?.request.urlTemplate).toBe('{{baseUrl}}/ping');
    expect(c?.source?.origin).toBeUndefined();
    expect(brunoToContract('vars {\n  a: b\n}\n', 'env', 'i').contract).toBeNull();
  });

  it('블록 파서가 목록 블록과 본문 들여쓰기를 처리한다', () => {
    const blocks = parseBruBlocks('meta {\n  name: a\n  tags: [\n    x\n  ]\n}\n\nbody:json {\n  {\n    "a": 1\n  }\n}\n');
    expect(blocks['body:json']).toEqual(['{', '  "a": 1', '}']);
  });
});

describe('내보낸 검증기(Bruno tests용 JS)', () => {
  it('validateShape와 같은 결과를 낸다', () => {
    const check = buildBrunoShapeChecker();
    const shape = contract.expect.bodyShape!;
    const rules = contract.expect.fieldRules!;
    const cases: unknown[] = [
      { token: 'x', user: { id: 1, tags: ['b', 'c'] }, at: 5 },
      { token: 1, user: { id: 2, tags: ['b'] } },
      { token: 'x', user: { id: 1, tags: [1] }, at: 'z' },
      { token: 'x', user: 'nope' },
      []
    ];
    for (const value of cases) {
      const mine = validateShape(value, shape, '$', rules).map((v) => v.path).sort();
      const theirs = check(value, shape, rules).map((m) => m.split(':')[0]).sort();
      expect(theirs).toEqual(mine);
    }
  });
});
