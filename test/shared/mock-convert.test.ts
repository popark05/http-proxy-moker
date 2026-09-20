import { describe, it, expect } from 'vitest';
import {
  exchangeToMock,
  mockToSerializedRule,
  pathWithoutQuery
} from '../../src/shared/mock-convert';
import { methodToEnum, enumToMethod } from '../../src/shared/mock';
import type { CapturedExchange } from '../../src/shared/capture';

function makeExchange(over: Partial<CapturedExchange> = {}): CapturedExchange {
  return {
    id: 'x1',
    startedAt: 1000,
    request: {
      method: 'GET',
      url: 'https://api.example.com/users?page=2',
      path: '/users?page=2',
      headers: [['accept', 'application/json']],
      body: { encoding: 'empty', content: '', byteLength: 0 }
    },
    response: {
      statusCode: 200,
      statusMessage: 'OK',
      headers: [['content-type', 'application/json']],
      body: { encoding: 'text', content: '[{"id":1}]', byteLength: 10, contentType: 'application/json' }
    },
    ...over
  };
}

describe('pathWithoutQuery', () => {
  it('쿼리를 제거하고 경로만 반환', () => {
    expect(pathWithoutQuery('https://x.com/a/b?q=1')).toBe('/a/b');
    expect(pathWithoutQuery('/a?q=1')).toBe('/a');
    expect(pathWithoutQuery('/a')).toBe('/a');
  });
});

describe('method enum 매핑', () => {
  it('메서드↔enum 왕복', () => {
    expect(methodToEnum('GET')).toBe(0);
    expect(methodToEnum('post')).toBe(1);
    expect(methodToEnum('DELETE')).toBe(3);
    expect(enumToMethod(1)).toBe('POST');
    expect(methodToEnum('UNKNOWN')).toBe(0); // 폴백 GET
  });
});

describe('exchangeToMock', () => {
  it('응답 있는 exchange를 목으로 복제(경로에서 쿼리 제거)', () => {
    const mock = exchangeToMock(makeExchange(), 'm1');
    expect(mock.id).toBe('m1');
    expect(mock.method).toBe('GET');
    expect(mock.path).toBe('/users'); // 쿼리 제거
    expect(mock.response.status).toBe(200);
    expect(mock.response.body).toBe('[{"id":1}]');
    expect(mock.enabled).toBe(true);
  });

  it('응답 없음(pending)은 기본 200 빈 응답', () => {
    const mock = exchangeToMock(makeExchange({ response: undefined }), 'm2');
    expect(mock.response.status).toBe(200);
    expect(mock.response.body).toBe('');
  });

  it('이진(base64) 응답 body는 빈 텍스트로 복제', () => {
    const mock = exchangeToMock(
      makeExchange({
        response: {
          statusCode: 200,
          statusMessage: 'OK',
          headers: [],
          body: { encoding: 'base64', content: 'AAEC', byteLength: 3 }
        }
      }),
      'm3'
    );
    expect(mock.response.body).toBe('');
  });
});

describe('mockToSerializedRule', () => {
  it('method+path matcher와 simple step으로 변환', () => {
    const mock = exchangeToMock(makeExchange(), 'm1');
    const rule = mockToSerializedRule(mock);

    expect(rule.id).toBe('m1');
    expect(rule.priority).toBe(1);
    expect(rule.matchers).toEqual([
      { type: 'method', method: 0 },
      { type: 'simple-path', path: '/users' }
    ]);
    expect(rule.steps).toHaveLength(1);
    expect(rule.steps[0].type).toBe('simple');
    expect(rule.steps[0].status).toBe(200);
    expect(rule.steps[0].data).toBe('[{"id":1}]');
    expect(rule.steps[0].headers).toEqual({ 'content-type': 'application/json' });
  });

  it('빈 body/헤더는 필드를 생략', () => {
    const mock = exchangeToMock(makeExchange({ response: undefined }), 'm2');
    const rule = mockToSerializedRule(mock);
    expect(rule.steps[0].data).toBeUndefined();
    expect(rule.steps[0].headers).toBeUndefined();
  });
});
