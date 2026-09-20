/**
 * 목 정의 및 mockttp 룰 직렬화 타입.
 *
 * 우리 앱의 MockDefinition은 편집하기 쉬운 형태로 두고,
 * mockttp에 주입할 때 Serialized<RequestRuleData>로 변환한다.
 * 완전 목킹을 위해 선언적 matcher(method+path) + FixedResponseStep(type:'simple')만 사용한다.
 */

/** mockttp Method enum 순서(GET=0..QUERY=8). 직렬화된 MethodMatcher가 숫자를 요구. */
export const METHOD_ENUM = [
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'HEAD',
  'OPTIONS',
  'TRACE',
  'QUERY'
] as const;

export function methodToEnum(method: string): number {
  const idx = METHOD_ENUM.indexOf(method.toUpperCase() as (typeof METHOD_ENUM)[number]);
  return idx >= 0 ? idx : 0; // 알 수 없으면 GET
}

export function enumToMethod(value: number): string {
  return METHOD_ENUM[value] ?? 'GET';
}

/** 편집 가능한 목 응답. */
export interface MockResponse {
  status: number;
  statusMessage?: string;
  /** 헤더 [name, value][]. */
  headers: Array<[string, string]>;
  /** 응답 본문(텍스트). 이진은 Phase 1에서 텍스트로만 편집. */
  body: string;
}

/**
 * 에러(fault) 주입 종류.
 * - none: 정상 응답
 * - timeout: 응답 없이 무한 대기(클라이언트 타임아웃 시뮬레이션)
 * - reset: TCP 연결 리셋(RST)
 * - close: 연결 즉시 종료
 */
export type MockFault = 'none' | 'timeout' | 'reset' | 'close';

/** 하나의 목 정의(요청 매칭 + 응답). */
export interface MockDefinition {
  id: string;
  /** 사용자에게 보여줄 라벨. */
  label: string;
  /** 매칭할 HTTP 메서드. */
  method: string;
  /**
   * 매칭할 경로(쿼리 제외, 예: /api/users).
   * FlexiblePathMatcher는 쿼리를 허용하지 않으므로 경로만.
   */
  path: string;
  response: MockResponse;
  /** 활성 여부. */
  enabled: boolean;
  /** 응답 전 지연(ms). 0/미지정이면 지연 없음. */
  delayMs?: number;
  /** 에러 주입. 'none'/미지정이면 정상 응답. timeout/reset/close면 응답 대신 에러. */
  fault?: MockFault;
}

/** 목 시나리오: 목 정의의 집합. scenarios/<name>.json으로 저장. */
export interface MockScenario {
  version: 1;
  id: string;
  name: string;
  description?: string;
  mocks: MockDefinition[];
}

/** 매칭 안 된 요청 처리 정책. */
export type UnmatchedPolicy =
  | 'passthrough' // 실제 백엔드로 통과(관찰 계속)
  | 'block'; // 503으로 차단(완전 목킹 전용)

/** 목킹 모드 적용 요청. */
export interface ApplyMocksArgs {
  mocks: MockDefinition[];
  unmatchedPolicy: UnmatchedPolicy;
}

// --- mockttp Serialized<RequestRuleData> 형태 ---

export interface SerializedMethodMatcher {
  type: 'method';
  method: number;
}

export interface SerializedPathMatcher {
  type: 'simple-path';
  path: string;
}

export interface SerializedFixedResponseStep {
  type: 'simple';
  status: number;
  statusMessage?: string;
  /** 문자열 body. mockttp는 string|Buffer 허용. */
  data?: string;
  headers?: Record<string, string>;
}

export interface SerializedRequestRule {
  id: string;
  priority?: number;
  matchers: Array<SerializedMethodMatcher | SerializedPathMatcher>;
  steps: SerializedFixedResponseStep[];
}
