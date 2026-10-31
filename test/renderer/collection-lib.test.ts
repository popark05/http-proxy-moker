import { describe, it, expect } from 'vitest';
import type { Contract } from '../../src/shared/contract';
import {
  applyUrlText,
  groupByServer,
  headersToText,
  newRequest,
  textToHeaders,
  urlTextOf,
  variablesOf,
  withRequest
} from '../../src/renderer/src/lib/collection';

const base = newRequest([], 'x');

describe('URL 한 줄 편집', () => {
  it('쿼리를 합쳐 보여 주고 다시 나눈다', () => {
    const r = { ...base.request, urlTemplate: '{{baseUrl}}/users', query: [['page', '2'], ['q', 'a b']] as Array<[string, string]> };
    expect(urlTextOf(r)).toBe('{{baseUrl}}/users?page=2&q=a b');
    const back = applyUrlText(r, '{{baseUrl}}/users?page=3&flag&q={{term}}');
    expect(back.urlTemplate).toBe('{{baseUrl}}/users');
    expect(back.query).toEqual([['page', '3'], ['flag', ''], ['q', '{{term}}']]);
    expect(applyUrlText(r, '{{baseUrl}}/x').query).toEqual([]);
  });
});

describe('헤더 텍스트', () => {
  it('왕복하고 형식이 아닌 줄은 버린다', () => {
    const text = 'Accept: application/json\nX-Trace: a:b\n잘못된 줄\n: 빈이름';
    expect(textToHeaders(text)).toEqual([['Accept', 'application/json'], ['X-Trace', 'a:b']]);
    expect(headersToText([['A', '1'], ['B', '2']])).toBe('A: 1\nB: 2');
  });
});

describe('컬렉션 모델', () => {
  it('새 요청 이름은 겹치지 않는다', () => {
    expect(newRequest(['새 요청'], 'y').name).toBe('새 요청 (2)');
  });

  it('메서드를 바꾸면 안전 여부가 따라간다', () => {
    expect(withRequest(base, { ...base.request, method: 'POST' }).safeToRun).toBe(false);
    expect(withRequest(base, { ...base.request, method: 'GET' }).safeToRun).toBe(true);
  });

  it('서버별 폴더로 묶고 출처 없는 요청은 맨 뒤', () => {
    const c = (name: string, origin?: string): Contract => ({ ...base, name, source: origin ? { capturedAt: 1, origin } : undefined });
    const folders = groupByServer([c('b', 'https://z.com'), c('x'), c('a', 'https://a.com'), c('c', 'https://z.com')]);
    expect(folders.map((f) => f.origin)).toEqual(['https://a.com', 'https://z.com', '']);
    expect(folders[1].items.map((i) => i.name)).toEqual(['b', 'c']);
  });

  it('입력받을 변수를 모은다(baseUrl 제외)', () => {
    const c = { ...base, request: { ...base.request, urlTemplate: '{{baseUrl}}/{{id}}', headers: [['Authorization', '{{token}}']] as Array<[string, string]> } };
    expect(variablesOf(c)).toEqual(['id', 'token']);
  });
});
