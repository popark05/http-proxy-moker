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
      // 이진(이미지 등)은 base64 그대로 보존해 본문이 사라지지 않게 한다. 크기 초과로 생략된 본문만 빈 값.
      body: response.body.encoding === 'omitted' || response.body.encoding === 'empty' ? '' : response.body.content,
      ...(response.body.encoding === 'base64' ? { bodyEncoding: 'base64' as const } : {})
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
 * 여러 exchange를 목으로 복제할 대상만 추린다.
 * 같은 method+path는 목이 하나만 의미 있으므로: 이미 목에 있는 조합은 건너뛰고(skipped),
 * 선택 안에서 겹치면 가장 나중(최신) 캡처를 남긴다. 결과 순서는 입력(선택) 순서를 유지한다.
 */
export function pickExchangesToClone(
  exchanges: CapturedExchange[],
  existing: MockDefinition[]
): { targets: CapturedExchange[]; skipped: number } {
  const key = (method: string, path: string): string => `${method.toUpperCase()} ${path}`;
  const taken = new Set(existing.map((m) => key(m.method, m.path)));
  const latest = new Map<string, CapturedExchange>();
  let skipped = 0;
  for (const ex of exchanges) {
    const k = key(ex.request.method, pathWithoutQuery(ex.request.url));
    if (taken.has(k)) {
      skipped++;
      continue;
    }
    if (latest.has(k)) skipped++;
    latest.set(k, ex);
  }
  // Map은 삽입 순서를 유지하지만, 같은 키를 덮어써도 처음 위치에 남는다(선택 순서 기준으로 충분).
  return { targets: [...latest.values()], skipped };
}

/** 응답 본문을 mockttp step의 data로. base64면 Buffer 직렬화 형태(IPC 구조화 복제 가능한 순수 데이터). */
function responseData(response: MockResponse): string | { type: 'Buffer'; data: number[] } {
  if (response.bodyEncoding !== 'base64') return response.body;
  // 렌더러 번들에도 포함되는 모듈이라 Buffer 대신 atob을 쓴다.
  const binary = atob(response.body);
  const data = new Array<number>(binary.length);
  for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
  return { type: 'Buffer', data };
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
        ...(mock.response.body ? { data: responseData(mock.response) } : {}),
        ...(mock.response.headers.length > 0
          ? { headers: headersToRecord(mock.response.headers) }
          : {})
      }
    ]
  };
}
