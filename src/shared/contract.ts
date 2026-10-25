/**
 * 계약(Contract): 캡처한 요청/응답을 "요청 견본 + 기대 응답 모양"으로 저장한 것.
 * 백엔드 검증(실제 서버로 재전송 후 응답 모양 비교)과 프론트엔드 검증(요청 위반 탐지)의 공통 기반이다.
 * 순수 함수만 담는다(단위 테스트 가능, main/renderer/워커 어디서나 사용).
 */

import type { CapturedExchange } from './capture';
import { pathWithoutQuery } from './mock-convert';

/** 응답 본문 모양. 값이 아니라 타입/필수 여부를 비교한다. */
export type JsonShape =
  | { kind: 'any' }
  | { kind: 'null' }
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'array'; items: JsonShape }
  | { kind: 'object'; props: Record<string, JsonShape>; required: string[] }
  | { kind: 'union'; of: JsonShape[] };

export interface ContractRequest {
  method: string;
  /** 호스트는 변수로 치환: "{{baseUrl}}/v1/users". */
  urlTemplate: string;
  query: Array<[string, string]>;
  /** 값에 {{var}} 가능. 민감 헤더는 값을 저장하지 않고 변수 이름만 둔다. */
  headers: Array<[string, string]>;
  body?: { encoding: 'text' | 'base64'; content: string; contentType?: string };
}

export interface ContractExpect {
  status: number | { min: number; max: number };
  /** 있어야 하는 응답 헤더 이름(소문자). */
  headers: string[];
  /** JSON 응답 모양. 추론 불가(비 JSON/생략)면 undefined → 상태/헤더만 검증. */
  bodyShape?: JsonShape;
  /** 필드별 예외 규칙. 키는 `$.items[].id`처럼 배열 인덱스를 `[]`로 쓴 경로. 없으면 타입만 비교. */
  fieldRules?: Record<string, FieldRule>;
}

/** 필드 비교 방식: 무시하거나, 특정 값과 같아야 한다(기본은 타입만 비교). */
export type FieldRule = { mode: 'ignore' } | { mode: 'equals'; value: unknown };

export interface Contract {
  version: 1;
  id: string;
  /** `METHOD /path` (케이스 라이브러리 endpoint id와 같은 규칙). */
  endpointId: string;
  name: string;
  /** origin: 캡처된 서버(https://host[:port]). 실행 대상의 기본값. */
  source?: { exchangeId?: string; capturedAt: number; origin?: string };
  request: ContractRequest;
  expect: ContractExpect;
  /** 실제 서버에서 재현 가능한 응답인가(500/타임아웃 등은 false). */
  verifiable: boolean;
  /** 실제 서버로 보내도 안전한가. 기본: GET/HEAD/OPTIONS만 true. */
  safeToRun: boolean;
  tags?: string[];
}

export interface ShapeViolation {
  /** JSONPath 형태: `$.items[2].id` */
  path: string;
  message: string;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** 값을 저장하지 않고 변수로만 두는 민감 헤더. */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token'
]);

/** 요청 헤더 중 계약에 넣지 않는 것(재전송 시 클라이언트가 다시 계산). */
const SKIPPED_REQUEST_HEADERS = new Set(['host', 'content-length', 'connection', 'accept-encoding', 'proxy-connection']);

/** 응답 헤더 중 매번 달라지거나 전송 계층 것이라 기대에서 제외. */
const SKIPPED_RESPONSE_HEADERS = new Set([
  'date',
  'content-length',
  'connection',
  'transfer-encoding',
  'keep-alive',
  'set-cookie',
  'age',
  'etag',
  'last-modified',
  'server'
]);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

// ---------- 모양 추론 ----------

export function inferShape(value: unknown): JsonShape {
  if (value === null) return { kind: 'null' };
  if (Array.isArray(value)) {
    return {
      kind: 'array',
      items: value.length === 0 ? { kind: 'any' } : value.map(inferShape).reduce(mergeShapes)
    };
  }
  switch (typeof value) {
    case 'string':
      return { kind: 'string' };
    case 'number':
      return { kind: 'number' };
    case 'boolean':
      return { kind: 'boolean' };
    case 'object': {
      const props: Record<string, JsonShape> = {};
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) props[key] = inferShape(v);
      return { kind: 'object', props, required: Object.keys(props) };
    }
    default:
      return { kind: 'any' };
  }
}

/**
 * 두 모양을 합친다(같은 엔드포인트의 여러 샘플 / 배열 원소).
 * 객체는 한쪽에만 있는 키가 선택 필드가 되고, 타입이 다르면 union이 된다.
 */
export function mergeShapes(a: JsonShape, b: JsonShape): JsonShape {
  if (a.kind === 'any') return b;
  if (b.kind === 'any') return a;
  if (a.kind === 'union' || b.kind === 'union') {
    const members = [...(a.kind === 'union' ? a.of : [a]), ...(b.kind === 'union' ? b.of : [b])];
    return normalizeUnion(members);
  }
  if (a.kind !== b.kind) return { kind: 'union', of: [a, b] };
  if (a.kind === 'array' && b.kind === 'array') return { kind: 'array', items: mergeShapes(a.items, b.items) };
  if (a.kind === 'object' && b.kind === 'object') {
    const props: Record<string, JsonShape> = {};
    for (const key of new Set([...Object.keys(a.props), ...Object.keys(b.props)])) {
      const pa = a.props[key];
      const pb = b.props[key];
      props[key] = pa && pb ? mergeShapes(pa, pb) : (pa ?? pb)!;
    }
    return { kind: 'object', props, required: a.required.filter((k) => b.required.includes(k)) };
  }
  return a;
}

/** union 멤버를 kind별로 합치고 하나만 남으면 풀어준다. */
function normalizeUnion(members: JsonShape[]): JsonShape {
  const byKind = new Map<string, JsonShape>();
  for (const m of members) {
    const prev = byKind.get(m.kind);
    byKind.set(m.kind, prev ? mergeShapes(prev, m) : m);
  }
  const merged = [...byKind.values()];
  return merged.length === 1 ? merged[0] : { kind: 'union', of: merged };
}

// ---------- 모양 검증 ----------

function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

const KIND_LABEL: Record<string, string> = {
  null: 'null',
  string: '문자열',
  number: '숫자',
  boolean: '불리언',
  array: '배열',
  object: '객체'
};

function describeShape(shape: JsonShape): string {
  if (shape.kind === 'union') return shape.of.map(describeShape).join(' 또는 ');
  return KIND_LABEL[shape.kind] ?? '임의 값';
}

/** 값이 모양과 맞는지 검증하고 위반 목록을 돌려준다(빈 배열이면 통과). */
export function validateShape(
  value: unknown,
  shape: JsonShape,
  path = '$',
  rules?: Record<string, FieldRule>
): ShapeViolation[] {
  const rule = rules?.[normalizeFieldPath(path)];
  if (rule?.mode === 'ignore') return [];
  if (rule?.mode === 'equals') {
    return deepEqual(value, rule.value)
      ? []
      : [{ path, message: `${JSON.stringify(rule.value)}이어야 함 (실제: ${JSON.stringify(value)})` }];
  }
  switch (shape.kind) {
    case 'any':
      return [];
    case 'union': {
      const ok = shape.of.some((member) => validateShape(value, member, path, rules).length === 0);
      return ok ? [] : [{ path, message: `${describeShape(shape)}여야 함 (실제: ${KIND_LABEL[kindOf(value)]})` }];
    }
    case 'array': {
      if (!Array.isArray(value)) return [{ path, message: `배열이어야 함 (실제: ${KIND_LABEL[kindOf(value)]})` }];
      return value.flatMap((item, i) => validateShape(item, shape.items, `${path}[${i}]`, rules));
    }
    case 'object': {
      if (kindOf(value) !== 'object') {
        return [{ path, message: `객체여야 함 (실제: ${KIND_LABEL[kindOf(value)]})` }];
      }
      const obj = value as Record<string, unknown>;
      const violations: ShapeViolation[] = [];
      for (const key of shape.required) {
        if (rules?.[normalizeFieldPath(`${path}.${key}`)]?.mode === 'ignore') continue;
        if (!(key in obj)) violations.push({ path: `${path}.${key}`, message: '필수 필드가 없음' });
      }
      for (const [key, sub] of Object.entries(shape.props)) {
        if (key in obj) violations.push(...validateShape(obj[key], sub, `${path}.${key}`, rules));
      }
      return violations;
    }
    default:
      return kindOf(value) === shape.kind
        ? []
        : [{ path, message: `${describeShape(shape)}여야 함 (실제: ${KIND_LABEL[kindOf(value)]})` }];
  }
}

/** 규칙 조회용 경로: `$.items[3].id` → `$.items[].id`. */
export function normalizeFieldPath(path: string): string {
  return path.replace(/\[\d+\]/g, '[]');
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export interface ShapeField {
  /** 규칙 키로 쓰는 경로(`$.items[].id`). */
  path: string;
  /** 사람이 읽는 타입 이름. */
  type: string;
  required: boolean;
}

/** 편집 화면용: 모양을 필드 목록으로 펼친다(루트 제외, 배열 원소는 `[]`). */
export function listShapeFields(shape: JsonShape, path = '$', required = true): ShapeField[] {
  const own: ShapeField[] = path === '$' ? [] : [{ path, type: describeShape(shape), required }];
  switch (shape.kind) {
    case 'object':
      return [
        ...own,
        ...Object.entries(shape.props).flatMap(([k, sub]) =>
          listShapeFields(sub, `${path}.${k}`, shape.required.includes(k))
        )
      ];
    case 'array':
      return [...own, ...listShapeFields(shape.items, `${path}[]`, true)];
    case 'union':
      return [...own, ...shape.of.flatMap((m) => (m.kind === 'object' || m.kind === 'array' ? listShapeFields(m, path, required) : []))];
    default:
      return own;
  }
}

// ---------- 변수 치환 ----------

const VAR_PATTERN = /\{\{\s*([\w.-]+)\s*\}\}/g;

/** 문자열의 {{name}}을 vars로 치환한다. 없는 변수는 missing에 모은다(치환하지 않고 남김). */
export function applyVariables(
  text: string,
  vars: Record<string, string>
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const out = text.replace(VAR_PATTERN, (whole, name: string) => {
    if (name in vars) return vars[name];
    if (!missing.includes(name)) missing.push(name);
    return whole;
  });
  return { text: out, missing };
}

/** 문자열에 쓰인 변수 이름 목록(실행 전 입력 폼용). */
export function listVariables(text: string): string[] {
  return [...new Set([...text.matchAll(VAR_PATTERN)].map((m) => m[1]))];
}

// ---------- 캡처 → 계약 ----------

/** 헤더 이름 → 변수 이름: `Authorization` → `authorization`, `X-Api-Key` → `x_api_key`. */
function headerVariable(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

/** 값을 저장하지 않고 변수로만 두는 필드 이름(쿼리, 요청 본문). */
const SENSITIVE_KEY =
  /pass(word|wd)?|pwd|token|secret|api[-_]?key|apikey|auth|session|otp|pin(code)?$|ssn|jumin|rrn|card|cvc|cvv|account|phone|mobile|tel$|email|birth/i;

function fieldVariable(key: string): string {
  return key.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'value';
}

/** JSON 값 안의 민감 키의 문자열/숫자 값을 `{{키}}` 변수로 바꾼다(중첩 포함). */
function maskJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE_KEY.test(k) && (typeof v === 'string' || typeof v === 'number') ? `{{${fieldVariable(k)}}}` : maskJson(v)
      ])
    );
  }
  return value;
}

/** 요청 본문에서 민감한 값을 변수로 치환한다. JSON/폼 인코딩만 다루고 나머지는 그대로 둔다. */
export function maskRequestBody(content: string, contentType?: string): string {
  const type = (contentType ?? '').toLowerCase();
  try {
    if (type.includes('json') || /^\s*[{[]/.test(content)) return JSON.stringify(maskJson(JSON.parse(content)));
  } catch {
    // JSON이 아니면 아래로.
  }
  if (type.includes('x-www-form-urlencoded')) {
    const params = new URLSearchParams(content);
    for (const [k] of [...params.entries()]) {
      if (SENSITIVE_KEY.test(k)) params.set(k, `{{${fieldVariable(k)}}}`);
    }
    return params.toString().replace(/%7B%7B/g, '{{').replace(/%7D%7D/g, '}}');
  }
  return content;
}

function maskQuery(query: Array<[string, string]>): Array<[string, string]> {
  return query.map(([k, v]): [string, string] => (SENSITIVE_KEY.test(k) ? [k, `{{${fieldVariable(k)}}}`] : [k, v]));
}

function parseJson(body: { encoding: string; content: string }): unknown | undefined {
  if (body.encoding !== 'text') return undefined;
  try {
    return JSON.parse(body.content);
  } catch {
    return undefined;
  }
}

/**
 * 캡처 exchange로 계약을 만든다. 응답이 없거나 중단된 exchange는 null.
 * 서버 주소는 `{{baseUrl}}`, 민감 헤더는 `{{헤더이름}}` 변수로 치환해 값이 파일에 남지 않게 한다.
 */
export function exchangeToContract(exchange: CapturedExchange, id: string): Contract | null {
  const { request, response } = exchange;
  if (!response || response === 'aborted') return null;

  const path = pathWithoutQuery(request.url);
  let query: Array<[string, string]> = [];
  let origin: string | undefined;
  try {
    const parsed = new URL(request.url);
    query = maskQuery([...parsed.searchParams.entries()]);
    origin = parsed.origin;
  } catch {
    // 상대 경로 등: 쿼리/서버 정보 없음으로 둔다.
  }

  const headers: Array<[string, string]> = request.headers
    .filter(([name]) => !SKIPPED_REQUEST_HEADERS.has(name.toLowerCase()))
    .map(([name, value]): [string, string] =>
      SENSITIVE_HEADERS.has(name.toLowerCase()) ? [name, `{{${headerVariable(name)}}}`] : [name, value]
    );

  const method = request.method.toUpperCase();
  const reqBody = request.body;
  const json = parseJson(response.body);

  return {
    version: 1,
    id,
    endpointId: `${method} ${path}`,
    name: `${method} ${path}`,
    source: { exchangeId: exchange.id, capturedAt: exchange.startedAt, ...(origin ? { origin } : {}) },
    request: {
      method,
      urlTemplate: `{{baseUrl}}${path}`,
      query,
      headers,
      ...(reqBody.encoding === 'text' || reqBody.encoding === 'base64'
        ? {
            body: {
              encoding: reqBody.encoding,
              // 이진(base64)은 내용을 알 수 없어 그대로 두고, 텍스트만 민감 값을 가린다.
              content: reqBody.encoding === 'text' ? maskRequestBody(reqBody.content, reqBody.contentType) : reqBody.content,
              contentType: reqBody.contentType
            }
          }
        : {})
    },
    expect: {
      status: response.statusCode,
      headers: [
        ...new Set(
          response.headers.map(([n]) => n.toLowerCase()).filter((n) => !SKIPPED_RESPONSE_HEADERS.has(n))
        )
      ],
      ...(json !== undefined ? { bodyShape: inferShape(json) } : {})
    },
    // 서버 오류 응답은 실제 서버에서 재현하기 어려워 기본 검증 대상에서 뺀다.
    verifiable: response.statusCode < 500,
    safeToRun: isSafeMethod(method)
  };
}

// ---------- 응답 검증 ----------

export interface ActualResponse {
  status: number;
  headers: Array<[string, string]>;
  /** 텍스트 본문(이진/생략이면 undefined). */
  body?: string;
}

export interface ContractCheck {
  passed: boolean;
  violations: ShapeViolation[];
}

/** 실제 응답이 계약의 기대와 맞는지 검사한다. */
export function checkResponse(expect: ContractExpect, actual: ActualResponse): ContractCheck {
  const violations: ShapeViolation[] = [];

  const { status } = expect;
  const statusOk =
    typeof status === 'number' ? actual.status === status : actual.status >= status.min && actual.status <= status.max;
  if (!statusOk) {
    const want = typeof status === 'number' ? `${status}` : `${status.min}~${status.max}`;
    violations.push({ path: 'status', message: `${want}이어야 함 (실제: ${actual.status})` });
  }

  const present = new Set(actual.headers.map(([n]) => n.toLowerCase()));
  for (const name of expect.headers) {
    if (!present.has(name)) violations.push({ path: `headers.${name}`, message: '응답 헤더가 없음' });
  }

  if (expect.bodyShape) {
    let parsed: unknown;
    let ok = actual.body !== undefined;
    if (ok) {
      try {
        parsed = JSON.parse(actual.body as string);
      } catch {
        ok = false;
      }
    }
    if (ok) violations.push(...validateShape(parsed, expect.bodyShape, '$', expect.fieldRules));
    else violations.push({ path: '$', message: 'JSON 본문이어야 함' });
  }

  return { passed: violations.length === 0, violations };
}

// ---------- 실행 계획(요청 준비) ----------

export interface ContractRunOptions {
  /**
   * 서버 주소 지정(`{{baseUrl}}`로 들어감). 우선순위: hostMap[캡처한 origin] → baseUrl → 캡처한 origin.
   * 아무것도 없으면(캡처 출처가 없는 계약) 건너뛴다.
   */
  baseUrl?: string;
  /** 캡처한 origin → 대신 보낼 서버 주소. */
  hostMap?: Record<string, string>;
  /** 실행 시 입력하는 변수(토큰 등). 파일에 저장하지 않는다. */
  vars: Record<string, string>;
  /** GET/HEAD/OPTIONS 외 계약도 실행할지. */
  allowUnsafe?: boolean;
  /** 요청당 타임아웃(ms). 기본 10000. */
  timeoutMs?: number;
  /** 동시 실행 수. 기본 4. */
  concurrency?: number;
}

export type ContractRunStatus = 'passed' | 'failed' | 'skipped' | 'error';

export interface ContractRunResult {
  contractName: string;
  endpointId: string;
  status: ContractRunStatus;
  /** skipped/error 사유. */
  reason?: string;
  violations: ShapeViolation[];
  httpStatus?: number;
  durationMs?: number;
}

export interface PlannedRequest {
  method: string;
  url: string;
  headers: Array<[string, string]>;
  body?: { encoding: 'text' | 'base64'; content: string };
}

/** 실행 계획: 보낼 요청, 또는 건너뛰는 이유. */
export type RequestPlan =
  | { ok: true; request: PlannedRequest; /** 값이 비어 있어 뺀 헤더 이름. */ omittedHeaders: string[] }
  | { ok: false; reason: string };

/** 계약과 실행 옵션으로 실제 보낼 요청을 만든다. 안전장치(검증 불가/위험 메서드/변수 누락)는 여기서 건다. */
export function planRequest(contract: Contract, options: ContractRunOptions): RequestPlan {
  if (!contract.verifiable) return { ok: false, reason: '실제 서버에서 재현할 수 없는 응답(검증 제외)' };
  if (!contract.safeToRun && !options.allowUnsafe) {
    return { ok: false, reason: `${contract.request.method} 요청은 기본으로 실행하지 않음(실행 허용 필요)` };
  }
  const origin = contract.source?.origin;
  const baseUrl = (origin && options.hostMap?.[origin]) || options.baseUrl || origin;
  if (!baseUrl) return { ok: false, reason: '대상 서버를 알 수 없음(캡처 출처 없음 — 서버를 지정해야 함)' };
  if (!/^https?:\/\//i.test(baseUrl)) return { ok: false, reason: '서버 주소가 http(s)://로 시작해야 함' };

  const vars: Record<string, string> = { ...options.vars, baseUrl: baseUrl.replace(/\/+$/, '') };
  const missing = new Set<string>();
  const sub = (text: string): string => {
    const r = applyVariables(text, vars);
    r.missing.forEach((m) => missing.add(m));
    return r.text;
  };

  let url = sub(contract.request.urlTemplate);
  if (contract.request.query.length > 0) {
    const qs = new URLSearchParams();
    for (const [k, v] of contract.request.query) qs.append(sub(k), sub(v));
    url += (url.includes('?') ? '&' : '?') + qs.toString();
  }
  // 값이 통째로 비어 있는 변수({{cookie}} 등)인 헤더는 건너뛰지 않고 헤더만 뺀다(쿠키 없이도 받을 수 있는 요청이 많다).
  const omittedHeaders: string[] = [];
  const headers: Array<[string, string]> = [];
  for (const [n, v] of contract.request.headers) {
    const whole = /^\s*\{\{\s*([\w.-]+)\s*\}\}\s*$/.exec(v);
    if (whole && !vars[whole[1]]) {
      omittedHeaders.push(n);
      continue;
    }
    headers.push([n, sub(v)]);
  }
  const body = contract.request.body
    ? { encoding: contract.request.body.encoding, content: sub(contract.request.body.content) }
    : undefined;

  if (missing.size > 0) return { ok: false, reason: `변수 값이 필요함: ${[...missing].join(', ')}` };
  return { ok: true, request: { method: contract.request.method, url, headers, ...(body ? { body } : {}) }, omittedHeaders };
}

// ---------- 서버 등록 / 실행 폼 보조 ----------

/** 프로젝트에 등록하는 대상 서버(개발/스테이징). 실행은 등록된 서버로만 한다. */
export interface ContractServer {
  name: string;
  /** http(s)://host[:port] — 끝의 / 는 저장 시 제거. */
  baseUrl: string;
}

/** 서버 주소를 정규화한다. 올바른 http(s) 주소가 아니면 null. */
export function normalizeBaseUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/** 운영 서버로 보이는 이름/주소인가(실행 전 경고용). */
export function looksLikeProduction(server: ContractServer): boolean {
  const text = `${server.name} ${server.baseUrl}`.toLowerCase();
  return /(^|[^a-z])(prod|prd|production|live|real)([^a-z]|$)|운영|상용/.test(text);
}

/** 이미 있는 이름과 겹치지 않는 계약 이름(`이름`, `이름 (2)`, ...). */
export function uniqueContractName(existing: string[], base: string): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** 계약들이 실행 시 입력받아야 하는 변수 이름(baseUrl 제외). */
export function requiredVariables(contracts: Contract[]): string[] {
  const names = new Set<string>();
  for (const c of contracts) {
    const texts = [
      c.request.urlTemplate,
      ...c.request.query.flat(),
      ...c.request.headers.map(([, v]) => v),
      c.request.body?.content ?? ''
    ];
    for (const t of texts) for (const v of listVariables(t)) if (v !== 'baseUrl') names.add(v);
  }
  return [...names].sort();
}

export function summarizeRun(results: ContractRunResult[]): Record<ContractRunStatus, number> {
  const out: Record<ContractRunStatus, number> = { passed: 0, failed: 0, skipped: 0, error: 0 };
  for (const r of results) out[r.status]++;
  return out;
}

/** 계약들이 캡처된 서버(origin) 목록. 출처 없는 계약은 포함하지 않는다. */
export function contractOrigins(contracts: Contract[]): string[] {
  return [...new Set(contracts.flatMap((c) => (c.source?.origin ? [c.source.origin] : [])))].sort();
}

/** 같은 요청(엔드포인트 + 쿼리 키 + 메서드)이면 같은 계약으로 본다. */
export function sameRequest(a: Contract, b: Contract): boolean {
  const keys = (c: Contract): string => c.request.query.map(([k]) => k).sort().join('&');
  return a.endpointId === b.endpointId && keys(a) === keys(b);
}

/** 같은 요청을 다시 캡처했을 때 기존 계약에 합친다: 응답 모양을 합쳐 선택 필드를 더 정확히 하고, 기대 헤더는 공통분만 남긴다. */
export function mergeContractSample(existing: Contract, draft: Contract): Contract {
  const { bodyShape } = existing.expect;
  const merged = bodyShape && draft.expect.bodyShape ? mergeShapes(bodyShape, draft.expect.bodyShape) : (bodyShape ?? draft.expect.bodyShape);
  return {
    ...existing,
    expect: {
      ...existing.expect,
      headers: existing.expect.headers.filter((h) => draft.expect.headers.includes(h)),
      ...(merged ? { bodyShape: merged } : {})
    }
  };
}

/** 캡처 exchange들을 계약으로 바꾼다. 같은 요청은 하나로 합치고, 응답이 없는 것은 skipped로 센다. */
export function contractsFromExchanges(
  exchanges: CapturedExchange[],
  newId: () => string
): { contracts: Contract[]; skipped: number } {
  const contracts: Contract[] = [];
  let skipped = 0;
  for (const exchange of exchanges) {
    const draft = exchangeToContract(exchange, newId());
    if (!draft) {
      skipped++;
      continue;
    }
    const i = contracts.findIndex((c) => sameRequest(c, draft));
    if (i >= 0) contracts[i] = mergeContractSample(contracts[i], draft);
    else contracts.push(draft);
  }
  return { contracts, skipped };
}
