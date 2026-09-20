import { describe, it, expect } from 'vitest';
import {
  statusClassOf,
  hostOf,
  buildSearchIndex,
  matchesFilter,
  isFilterActive,
  applyFilter,
  collectHosts,
  collectTags
} from '../../src/shared/traffic-filter';
import type { CapturedExchange } from '../../src/shared/capture';

function ex(over: Partial<CapturedExchange> & { id: string }): CapturedExchange {
  return {
    startedAt: 1000,
    request: {
      method: 'GET',
      url: 'https://api.example.com/users',
      path: '/users',
      headers: [['accept', 'application/json']],
      destination: 'api.example.com:443',
      body: { encoding: 'empty', content: '', byteLength: 0 }
    },
    response: {
      statusCode: 200,
      statusMessage: 'OK',
      headers: [['content-type', 'application/json']],
      body: { encoding: 'text', content: '[{"name":"Alice"}]', byteLength: 18, contentType: 'application/json' }
    },
    ...over
  };
}

describe('statusClassOf', () => {
  it('상태코드/pending/aborted를 분류', () => {
    expect(statusClassOf(ex({ id: 'a' }))).toBe('2xx');
    expect(statusClassOf(ex({ id: 'b', response: { statusCode: 404, statusMessage: '', headers: [], body: { encoding: 'empty', content: '', byteLength: 0 } } }))).toBe('4xx');
    expect(statusClassOf(ex({ id: 'c', response: { statusCode: 500, statusMessage: '', headers: [], body: { encoding: 'empty', content: '', byteLength: 0 } } }))).toBe('5xx');
    expect(statusClassOf(ex({ id: 'd', response: undefined }))).toBe('pending');
    expect(statusClassOf(ex({ id: 'e', response: 'aborted' }))).toBe('error');
  });
});

describe('hostOf', () => {
  it('destination 우선, 없으면 URL에서 추출', () => {
    expect(hostOf(ex({ id: 'a' }))).toBe('api.example.com');
    expect(
      hostOf(
        ex({
          id: 'b',
          request: {
            method: 'GET',
            url: 'https://other.com/x',
            path: '/x',
            headers: [],
            body: { encoding: 'empty', content: '', byteLength: 0 }
          }
        })
      )
    ).toBe('other.com');
  });
});

describe('buildSearchIndex', () => {
  it('URL/헤더/본문/태그를 소문자로 인덱싱', () => {
    const idx = buildSearchIndex(ex({ id: 'a', tags: ['smoke'] }));
    expect(idx).toContain('api.example.com/users');
    expect(idx).toContain('content-type: application/json');
    expect(idx).toContain('alice');
    expect(idx).toContain('smoke');
  });
});

describe('matchesFilter', () => {
  it('텍스트 검색(대소문자 무시)', () => {
    expect(matchesFilter(ex({ id: 'a' }), { text: 'ALICE' })).toBe(true);
    expect(matchesFilter(ex({ id: 'a' }), { text: 'bob' })).toBe(false);
  });
  it('메서드 필터', () => {
    expect(matchesFilter(ex({ id: 'a' }), { methods: ['GET'] })).toBe(true);
    expect(matchesFilter(ex({ id: 'a' }), { methods: ['POST'] })).toBe(false);
  });
  it('상태 클래스 필터', () => {
    expect(matchesFilter(ex({ id: 'a' }), { statusClasses: ['2xx'] })).toBe(true);
    expect(matchesFilter(ex({ id: 'a' }), { statusClasses: ['5xx'] })).toBe(false);
  });
  it('호스트 부분 일치', () => {
    expect(matchesFilter(ex({ id: 'a' }), { host: 'example' })).toBe(true);
    expect(matchesFilter(ex({ id: 'a' }), { host: 'nope' })).toBe(false);
  });
  it('태그 AND 필터', () => {
    const tagged = ex({ id: 'a', tags: ['smoke', 'auth'] });
    expect(matchesFilter(tagged, { tags: ['smoke'] })).toBe(true);
    expect(matchesFilter(tagged, { tags: ['smoke', 'auth'] })).toBe(true);
    expect(matchesFilter(tagged, { tags: ['smoke', 'missing'] })).toBe(false);
  });
  it('여러 조건 AND 결합', () => {
    expect(matchesFilter(ex({ id: 'a' }), { methods: ['GET'], statusClasses: ['2xx'], text: 'alice' })).toBe(true);
    expect(matchesFilter(ex({ id: 'a' }), { methods: ['GET'], statusClasses: ['4xx'] })).toBe(false);
  });
});

describe('isFilterActive', () => {
  it('빈 필터는 비활성', () => {
    expect(isFilterActive({})).toBe(false);
    expect(isFilterActive({ text: '  ' })).toBe(false);
    expect(isFilterActive({ methods: [] })).toBe(false);
  });
  it('조건 있으면 활성', () => {
    expect(isFilterActive({ text: 'x' })).toBe(true);
    expect(isFilterActive({ methods: ['GET'] })).toBe(true);
    expect(isFilterActive({ tags: ['a'] })).toBe(true);
  });
});

describe('applyFilter', () => {
  const list = [
    ex({ id: 'a', request: { method: 'GET', url: 'https://a.com/1', path: '/1', headers: [], body: { encoding: 'empty', content: '', byteLength: 0 } } }),
    ex({ id: 'b', request: { method: 'POST', url: 'https://b.com/2', path: '/2', headers: [], body: { encoding: 'empty', content: '', byteLength: 0 } }, response: { statusCode: 500, statusMessage: 'ERR', headers: [], body: { encoding: 'empty', content: '', byteLength: 0 } } }),
    ex({ id: 'c', tags: ['smoke'] })
  ];

  it('비활성 필터는 전체 반환(동일 참조)', () => {
    expect(applyFilter(list, {})).toBe(list);
  });
  it('메서드 필터 적용', () => {
    expect(applyFilter(list, { methods: ['POST'] }).map((e) => e.id)).toEqual(['b']);
  });
  it('상태 5xx 필터', () => {
    expect(applyFilter(list, { statusClasses: ['5xx'] }).map((e) => e.id)).toEqual(['b']);
  });
  it('태그 필터', () => {
    expect(applyFilter(list, { tags: ['smoke'] }).map((e) => e.id)).toEqual(['c']);
  });
  it('인덱스 캐시를 재사용', () => {
    const cache = new Map<string, string>();
    applyFilter(list, { text: 'x' }, cache);
    expect(cache.size).toBe(list.length);
  });
});

describe('collectHosts / collectTags', () => {
  it('호스트/태그 목록을 중복 없이 정렬', () => {
    const list = [
      ex({ id: 'a' }),
      ex({ id: 'b', request: { method: 'GET', url: 'https://z.com/x', path: '/x', headers: [], body: { encoding: 'empty', content: '', byteLength: 0 } } }),
      ex({ id: 'c', tags: ['b', 'a'] }),
      ex({ id: 'd', tags: ['a'] })
    ];
    expect(collectHosts(list)).toEqual(['api.example.com', 'z.com']);
    expect(collectTags(list)).toEqual(['a', 'b']);
  });
});
