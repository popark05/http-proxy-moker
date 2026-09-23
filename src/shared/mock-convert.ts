/**
 * 캡처 exchange ↔ 목 정의 ↔ mockttp 직렬화 룰 변환.
 */

import type { CapturedExchange } from './capture';
import {
  methodToEnum,
  type MockDefinition,
  type MockResponse,
  type SerializedRequestRule
} from './mock';

/** URL에서 쿼리를 제외한 경로만 추출(FlexiblePathMatcher용). */
export function pathWithoutQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname;
  } catch {
    // 상대경로 등: ? 앞부분만.
    const q = url.indexOf('?');
    return q >= 0 ? url.slice(0, q) : url;
  }
}

/** headers [name,value][] → Record(중복은 마지막 값). */
function headersToRecord(headers: Array<[string, string]>): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [name, value] of headers) record[name] = value;
  return record;
}

/**
 * 캡처된 exchange를 편집 가능한 목 정의로 복제한다.
 * 응답이 없으면(pending/aborted) 기본 200 빈 응답으로 시작한다.
 * 이진(base64)/생략(omitted) body는 Phase 1에서 빈 텍스트로 대체(사용자가 편집).
 */
export function exchangeToMock(exchange: CapturedExchange, id: string): MockDefinition {
  const { request, response } = exchange;

  let mockResponse: MockResponse;
  if (response && response !== 'aborted') {
    mockResponse = {
      status: response.statusCode,
      statusMessage: response.statusMessage,
      headers: response.headers,
      body: response.body.encoding === 'text' ? response.body.content : ''
    };
  } else {
    mockResponse = { status: 200, headers: [], body: '' };
  }

  const path = pathWithoutQuery(request.url);
  return {
    id,
    label: `${request.method} ${path}`,
    method: request.method,
    path,
    response: mockResponse,
    enabled: true,
    // 원본 본문 보존(편집 후 diff/수정 여부 판단용).
    originalBody: mockResponse.body
  };
}

/**
 * 목 정의를 mockttp Serialized<RequestRuleData>로 변환한다.
 * matcher: MethodMatcher(method) + FlexiblePathMatcher(path).
 * step: FixedResponseStep(type:'simple') — 완전 목킹(업스트림 호출 없음).
 */
export function mockToSerializedRule(mock: MockDefinition): SerializedRequestRule {
  return {
    id: mock.id,
    priority: 1, // DEFAULT
    matchers: [
      { type: 'method', method: methodToEnum(mock.method) },
      { type: 'simple-path', path: mock.path }
    ],
    steps: [
      {
        type: 'simple',
        status: mock.response.status,
        ...(mock.response.statusMessage ? { statusMessage: mock.response.statusMessage } : {}),
        ...(mock.response.body ? { data: mock.response.body } : {}),
        ...(mock.response.headers.length > 0
          ? { headers: headersToRecord(mock.response.headers) }
          : {})
      }
    ]
  };
}
