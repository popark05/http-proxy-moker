import { describe, it, expect } from 'vitest';
import { reduceCapture, addTag, removeTag } from '../../src/renderer/src/state/capture-store';
import type { CapturedExchange, CapturedResponse } from '../../src/shared/capture';

function makeExchange(id: string): CapturedExchange {
  return {
    id,
    startedAt: 1000,
    request: {
      method: 'GET',
      url: `http://example.com/${id}`,
      path: `/${id}`,
      headers: [],
      body: { encoding: 'empty', content: '', byteLength: 0 }
    }
  };
}

const response: CapturedResponse = {
  statusCode: 200,
  statusMessage: 'OK',
  headers: [['content-type', 'application/json']],
  body: { encoding: 'text', content: '{}', byteLength: 2 }
};

describe('reduceCapture', () => {
  it('request 이벤트는 새 exchange를 추가한다', () => {
    const result = reduceCapture([], { type: 'request', exchange: makeExchange('a') });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  it('중복 id request는 무시한다', () => {
    const base = [makeExchange('a')];
    const result = reduceCapture(base, { type: 'request', exchange: makeExchange('a') });
    expect(result).toHaveLength(1);
  });

  it('response 이벤트는 id로 매칭해 응답을 채운다', () => {
    const base = [makeExchange('a'), makeExchange('b')];
    const result = reduceCapture(base, { type: 'response', id: 'b', response });
    expect(result[0].response).toBeUndefined();
    expect(result[1].response).toEqual(response);
  });

  it('abort 이벤트는 응답을 aborted로 표시한다', () => {
    const base = [makeExchange('a')];
    const result = reduceCapture(base, { type: 'abort', id: 'a' });
    expect(result[0].response).toBe('aborted');
  });

  it('매칭 안 되는 response는 목록을 바꾸지 않는다', () => {
    const base = [makeExchange('a')];
    const result = reduceCapture(base, { type: 'response', id: 'zzz', response });
    expect(result[0].response).toBeUndefined();
  });
});

describe('addTag / removeTag', () => {
  it('태그를 추가한다', () => {
    const result = addTag([makeExchange('a')], 'a', 'smoke');
    expect(result[0].tags).toEqual(['smoke']);
  });

  it('중복 태그는 무시한다', () => {
    const base = addTag([makeExchange('a')], 'a', 'smoke');
    const result = addTag(base, 'a', 'smoke');
    expect(result[0].tags).toEqual(['smoke']);
  });

  it('공백 태그는 무시한다', () => {
    const result = addTag([makeExchange('a')], 'a', '   ');
    expect(result[0].tags).toBeUndefined();
  });

  it('태그를 트림해서 추가한다', () => {
    const result = addTag([makeExchange('a')], 'a', '  auth  ');
    expect(result[0].tags).toEqual(['auth']);
  });

  it('다른 id는 건드리지 않는다', () => {
    const result = addTag([makeExchange('a'), makeExchange('b')], 'a', 'x');
    expect(result[0].tags).toEqual(['x']);
    expect(result[1].tags).toBeUndefined();
  });

  it('태그를 제거한다', () => {
    const base = addTag(addTag([makeExchange('a')], 'a', 'x'), 'a', 'y');
    const result = removeTag(base, 'a', 'x');
    expect(result[0].tags).toEqual(['y']);
  });
});
