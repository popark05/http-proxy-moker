/**
 * 캡처된 트래픽의 직렬화 가능한 표현.
 * main(mockttp)에서 renderer로 IPC를 통해 전달되므로 순수 데이터(구조화 복제 가능)만 담는다.
 * body는 크기 제한 후 텍스트 또는 base64로 인코딩한다.
 */

/** IPC로 전달 가능한 body 표현. */
export interface CapturedBody {
  /** 'text': utf-8 텍스트, 'base64': 이진 데이터, 'empty': 본문 없음, 'omitted': 크기 초과로 생략. */
  encoding: 'text' | 'base64' | 'empty' | 'omitted';
  /** encoding이 text/base64일 때의 실제 내용. empty/omitted면 빈 문자열. */
  content: string;
  /** 원본(디코딩된) 바이트 길이. omitted여도 크기는 보존. */
  byteLength: number;
  /** content-type 헤더 값(있으면). */
  contentType?: string;
}

export interface CapturedRequest {
  method: string;
  url: string;
  path: string;
  /** [name, value][] 형태의 원본 헤더(중복 헤더 보존). */
  headers: Array<[string, string]>;
  body: CapturedBody;
  /** 목적지 host:port (알 수 있으면). */
  destination?: string;
}

export interface CapturedResponse {
  statusCode: number;
  statusMessage: string;
  headers: Array<[string, string]>;
  body: CapturedBody;
}

/** 요청+응답을 id로 병합한 하나의 교환(exchange). */
export interface CapturedExchange {
  id: string;
  /** 캡처 시작 시각(epoch ms). */
  startedAt: number;
  request: CapturedRequest;
  /** 응답 도착 전이면 undefined, 중단되면 'aborted'. */
  response?: CapturedResponse | 'aborted';
  /** QA가 붙인 태그. 필터/분류에 사용. */
  tags?: string[];
}

/** main → renderer 캡처 이벤트. */
export type CaptureEvent =
  | { type: 'request'; exchange: CapturedExchange }
  | { type: 'response'; id: string; response: CapturedResponse }
  | { type: 'abort'; id: string };

/** 프록시 상태. */
export interface ProxyStatus {
  running: boolean;
  port?: number;
}

/** body를 IPC로 보낼 때의 크기 제한(초과 시 omitted). */
export const CAPTURE_BODY_SIZE_LIMIT = 500_000;
