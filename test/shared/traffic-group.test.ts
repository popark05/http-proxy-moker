import { describe, it, expect } from 'vitest';
import type { CapturedExchange } from '../../src/shared/capture';
import {
  checkStateOf,
  endpointStateKey,
  flattenRows,
  groupTraffic
} from '../../src/shared/traffic-group';

function ex(id: string, method: string, url: string, status = 200): CapturedExchange {
  return {
    id,
    startedAt: 1,
    request: {
      method,
      url,
      path: new URL(url).pathname,
      headers: [],
      body: { encoding: 'empty', content: '', byteLength: 0 }
    },
    response: {
      statusCode: status,
      statusMessage: '',
      headers: [],
      body: { encoding: 'empty', content: '', byteLength: 0 }
    }
  };
}

const sample = [
  ex('1', 'GET', 'https://api.a.com/feed?page=1'),
  ex('2', 'GET', 'https://cdn.b.com/x.js'),
  ex('3', 'GET', 'https://api.a.com/feed?page=2', 500),
  ex('4', 'POST', 'https://api.a.com/login'),
  ex('5', 'GET', 'https://api.a.com/feed?page=3')
];

describe('groupTraffic', () => {
  it('호스트 → method+path로 묶고 최초 등장 순서를 유지한다', () => {
    const groups = groupTraffic(sample);
    expect(groups.map((g) => g.host)).toEqual(['api.a.com', 'cdn.b.com']);
    const api = groups[0];
    expect(api.endpoints.map((e) => e.key)).toEqual(['GET /feed', 'POST /login']);
    expect(api.endpoints[0].exchanges.map((e) => e.id)).toEqual(['1', '3', '5']);
    expect(api.endpoints[0].latest.id).toBe('5');
    expect(api.exchanges).toHaveLength(4);
  });

  it('에러(4xx/5xx/중단) 수를 호스트별로 센다', () => {
    const aborted = { ...ex('6', 'GET', 'https://cdn.b.com/y'), response: 'aborted' as const };
    const groups = groupTraffic([...sample, aborted]);
    expect(groups.find((g) => g.host === 'api.a.com')!.errorCount).toBe(1);
    expect(groups.find((g) => g.host === 'cdn.b.com')!.errorCount).toBe(1);
  });

  it('다른 호스트의 같은 method+path는 합치지 않는다', () => {
    const groups = groupTraffic([ex('1', 'GET', 'https://a.com/x'), ex('2', 'GET', 'https://b.com/x')]);
    expect(groups.map((g) => g.endpoints.length)).toEqual([1, 1]);
  });
});

describe('flattenRows', () => {
  const groups = groupTraffic(sample);

  it('기본: 호스트 헤더 + 엔드포인트(호출 묶음은 접힘)', () => {
    const rows = flattenRows(groups, new Set(), new Set());
    expect(rows.map((r) => r.kind)).toEqual(['host', 'endpoint', 'endpoint', 'host', 'endpoint']);
  });

  it('접힌 호스트는 헤더만 남는다', () => {
    const rows = flattenRows(groups, new Set(['api.a.com']), new Set());
    expect(rows.map((r) => r.kind)).toEqual(['host', 'host', 'endpoint']);
  });

  it('펼친 엔드포인트는 개별 호출을 최신순으로 보여주고, 호출 1회짜리는 펼치지 않는다', () => {
    const feed = groups[0].endpoints[0];
    const login = groups[0].endpoints[1];
    const rows = flattenRows(
      groups,
      new Set(),
      new Set([endpointStateKey('api.a.com', feed), endpointStateKey('api.a.com', login)])
    );
    const calls = rows.filter((r) => r.kind === 'call');
    expect(calls.map((r) => (r.kind === 'call' ? r.exchange.id : ''))).toEqual(['5', '3', '1']);
  });
});

describe('checkStateOf', () => {
  it('전부/일부/없음', () => {
    expect(checkStateOf(['a', 'b'], new Set(['a', 'b']))).toBe('all');
    expect(checkStateOf(['a', 'b'], new Set(['a']))).toBe('some');
    expect(checkStateOf(['a', 'b'], new Set())).toBe('none');
  });
});
