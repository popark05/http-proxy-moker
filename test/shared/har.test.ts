import { describe, it, expect } from 'vitest';
import {
  exchangesToHar,
  harToExchanges,
  exchangeToHarEntry,
  harEntryToExchange
} from '../../src/shared/har';
import type { CapturedExchange } from '../../src/shared/capture';

function makeExchange(overrides: Partial<CapturedExchange> = {}): CapturedExchange {
  return {
    id: 'ex-1',
    startedAt: Date.parse('2026-01-01T00:00:00.000Z'),
    request: {
      method: 'POST',
      url: 'https://api.example.com/users?page=2',
      path: '/users?page=2',
      headers: [
        ['content-type', 'application/json'],
        ['authorization', 'Bearer token']
      ],
      destination: 'api.example.com:443',
      body: { encoding: 'text', content: '{"name":"Alice"}', byteLength: 16, contentType: 'application/json' }
    },
    response: {
      statusCode: 201,
      statusMessage: 'Created',
      headers: [['content-type', 'application/json']],
      body: { encoding: 'text', content: '{"id":1}', byteLength: 8, contentType: 'application/json' }
    },
    ...overrides
  };
}

describe('HAR 라운드트립', () => {
  it('텍스트 body exchange를 손실 없이 왕복', () => {
    const original = makeExchange();
    const back = harEntryToExchange(exchangeToHarEntry(original));

    expect(back.id).toBe(original.id);
    expect(back.request.method).toBe('POST');
    expect(back.request.url).toBe(original.request.url);
    expect(back.request.headers).toEqual(original.request.headers);
    expect(back.request.body.content).toBe('{"name":"Alice"}');
    expect(back.request.destination).toBe('api.example.com:443');
    expect(back.response).not.toBe('aborted');
    if (back.response && back.response !== 'aborted') {
      expect(back.response.statusCode).toBe(201);
      expect(back.response.body.content).toBe('{"id":1}');
    }
  });

  it('base64(이진) body를 보존', () => {
    const bin = makeExchange({
      request: {
        method: 'PUT',
        url: 'https://x.com/upload',
        path: '/upload',
        headers: [['content-type', 'application/octet-stream']],
        body: { encoding: 'base64', content: Buffer.from([0, 1, 2, 255]).toString('base64'), byteLength: 4, contentType: 'application/octet-stream' }
      }
    });
    const back = harEntryToExchange(exchangeToHarEntry(bin));
    expect(back.request.body.encoding).toBe('base64');
    expect(Buffer.from(back.request.body.content, 'base64')).toEqual(Buffer.from([0, 1, 2, 255]));
  });

  it('omitted(크기초과) body는 길이만 보존', () => {
    const ex = makeExchange({
      response: {
        statusCode: 200,
        statusMessage: 'OK',
        headers: [],
        body: { encoding: 'omitted', content: '', byteLength: 999999, contentType: 'video/mp4' }
      }
    });
    const back = harEntryToExchange(exchangeToHarEntry(ex));
    if (back.response && back.response !== 'aborted') {
      expect(back.response.body.encoding).toBe('omitted');
      expect(back.response.body.byteLength).toBe(999999);
    }
  });

  it('aborted 응답을 보존', () => {
    const ex = makeExchange({ response: 'aborted' });
    const back = harEntryToExchange(exchangeToHarEntry(ex));
    expect(back.response).toBe('aborted');
  });

  it('응답 없음(pending)을 보존', () => {
    const ex = makeExchange({ response: undefined });
    const back = harEntryToExchange(exchangeToHarEntry(ex));
    expect(back.response).toBeUndefined();
  });

  it('태그(tags)를 _tags로 보존', () => {
    const tagged = makeExchange({ tags: ['smoke', 'auth'] });
    const back = harEntryToExchange(exchangeToHarEntry(tagged));
    expect(back.tags).toEqual(['smoke', 'auth']);
  });

  it('태그 없으면 tags 필드 없음', () => {
    const back = harEntryToExchange(exchangeToHarEntry(makeExchange()));
    expect(back.tags).toBeUndefined();
  });

  it('여러 exchange를 HAR 로그로 묶고 되돌린다', () => {
    const list = [makeExchange({ id: 'a' }), makeExchange({ id: 'b', response: 'aborted' })];
    const har = exchangesToHar(list);
    expect(har.log.version).toBe('1.2');
    expect(har.log.entries).toHaveLength(2);

    const back = harToExchanges(har);
    expect(back.map((e) => e.id)).toEqual(['a', 'b']);
    expect(back[1].response).toBe('aborted');
  });
});
