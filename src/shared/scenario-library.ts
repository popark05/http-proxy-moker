/**
 * 케이스 라이브러리와 시나리오(v2).
 *
 * - 목(MockDefinition)은 작업 공간의 즉석 응답 규칙이고, 시나리오는 재사용하는 "케이스 선택의 묶음"이다.
 * - 엔드포인트(method+path)마다 이름 붙은 응답 케이스(정상/500/빈 목록/타임아웃...)를 라이브러리에 두고,
 *   시나리오는 케이스를 복사하지 않고 참조한다 → 케이스를 한 곳에서 고치면 모든 시나리오에 반영된다.
 * - 시나리오는 베이스를 상속해 일부 엔드포인트만 덮어쓸 수 있다(변형 시나리오).
 * - v1 시나리오(목 정의 복사본)는 결정적 ID로 라이브러리에 변환되므로, 저장하기 전에는 파일을 건드리지 않는다.
 *
 * 순수 로직만 둔다(IO 없음): 변환·해석 결과는 기존 MockDefinition[]이라 프록시 엔진은 그대로 쓴다.
 */
import type { MockDefinition, MockFault, MockResponse, MockScenario } from './mock';

export interface MockCase {
  /** 엔드포인트 안에서 유일한 식별자(이름을 바꿔도 참조가 유지된다). */
  id: string;
  /** 사람이 읽는 이름(엔드포인트 안에서 유일). 예: "정상", "500 서버 오류". */
  name: string;
  response: MockResponse;
  delayMs?: number;
  fault?: MockFault;
}

export interface LibraryEndpoint {
  /** `METHOD /path` */
  id: string;
  method: string;
  path: string;
  cases: MockCase[];
}

export interface CaseLibrary {
  version: 2;
  endpoints: LibraryEndpoint[];
}

export const EMPTY_LIBRARY: CaseLibrary = { version: 2, endpoints: [] };

export interface ScenarioPick {
  endpointId: string;
  /** null이면 이 엔드포인트를 제외한다(베이스에서 상속한 것을 끌 때). */
  caseId: string | null;
}

export interface ScenarioV2 {
  version: 2;
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  /** 상속할 베이스 시나리오 이름. */
  base?: string;
  picks: ScenarioPick[];
}

/** 디스크에 있을 수 있는 시나리오 파일(v1: 목 복사본, v2: 케이스 참조). */
export type ScenarioFile = MockScenario | ScenarioV2;

// ---------- 식별자/이름 ----------

export function endpointIdOf(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/** FNV-1a 32비트 해시(hex). 결정적 ID용이며 보안 용도가 아니다. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

interface CaseContent {
  response: MockResponse;
  delayMs?: number;
  fault?: MockFault;
}

/** 내용이 같으면 같은 값. 케이스 중복 판정과 v1 변환의 결정적 ID에 쓴다. */
export function contentHash(c: CaseContent): string {
  const r = c.response;
  return fnv1a(
    JSON.stringify([
      r.status,
      r.statusMessage ?? '',
      r.headers,
      r.body,
      r.bodyEncoding ?? 'text',
      c.delayMs ?? 0,
      c.fault && c.fault !== 'none' ? c.fault : 'none'
    ])
  );
}

const FAULT_NAME: Record<Exclude<MockFault, 'none'>, string> = {
  timeout: '타임아웃',
  reset: '연결 리셋',
  close: '연결 종료'
};

/** 응답 내용에서 기본 케이스 이름을 만든다("200", "500", "타임아웃", "200 +3000ms"). */
export function defaultCaseName(c: CaseContent): string {
  const base = c.fault && c.fault !== 'none' ? FAULT_NAME[c.fault] : String(c.response.status);
  return c.delayMs && c.delayMs > 0 ? `${base} +${c.delayMs}ms` : base;
}

/** names에 없는 이름이 되도록 " (2)", " (3)"을 붙인다. */
export function uniqueName(name: string, taken: readonly string[]): string {
  if (!taken.includes(name)) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name} (${i})`;
    if (!taken.includes(candidate)) return candidate;
  }
}

// ---------- 라이브러리 조작(불변) ----------

export function findEndpoint(library: CaseLibrary, endpointId: string): LibraryEndpoint | undefined {
  return library.endpoints.find((e) => e.id === endpointId);
}

export function findCase(library: CaseLibrary, endpointId: string, caseId: string): MockCase | undefined {
  return findEndpoint(library, endpointId)?.cases.find((c) => c.id === caseId);
}

function withEndpoint(library: CaseLibrary, endpoint: LibraryEndpoint): CaseLibrary {
  const exists = library.endpoints.some((e) => e.id === endpoint.id);
  return {
    ...library,
    endpoints: exists
      ? library.endpoints.map((e) => (e.id === endpoint.id ? endpoint : e))
      : [...library.endpoints, endpoint]
  };
}

export interface UpsertInput {
  method: string;
  path: string;
  response: MockResponse;
  delayMs?: number;
  fault?: MockFault;
}

/**
 * 응답을 케이스로 라이브러리에 넣는다. 같은 엔드포인트에 내용이 같은 케이스가 있으면 재사용한다.
 * name을 주면 그 이름으로(중복이면 번호를 붙여) 추가하고, 없으면 내용으로 이름을 만든다.
 */
export function upsertCase(
  library: CaseLibrary,
  input: UpsertInput,
  name?: string
): { library: CaseLibrary; endpointId: string; caseId: string; created: boolean } {
  const endpointId = endpointIdOf(input.method, input.path);
  const endpoint: LibraryEndpoint = findEndpoint(library, endpointId) ?? {
    id: endpointId,
    method: input.method.toUpperCase(),
    path: input.path,
    cases: []
  };
  const hash = contentHash(input);
  const same = endpoint.cases.find((c) => contentHash(c) === hash);
  if (same) return { library, endpointId, caseId: same.id, created: false };

  let id = `c-${hash}`;
  for (let i = 2; endpoint.cases.some((c) => c.id === id); i++) id = `c-${hash}-${i}`;
  const caseName = uniqueName(
    name?.trim() || defaultCaseName(input),
    endpoint.cases.map((c) => c.name)
  );
  const mockCase: MockCase = {
    id,
    name: caseName,
    response: input.response,
    ...(input.delayMs ? { delayMs: input.delayMs } : {}),
    ...(input.fault && input.fault !== 'none' ? { fault: input.fault } : {})
  };
  return {
    library: withEndpoint(library, { ...endpoint, cases: [...endpoint.cases, mockCase] }),
    endpointId,
    caseId: id,
    created: true
  };
}

/** 케이스의 이름/응답/지연/에러를 바꾼다(ID는 유지). */
export function updateCase(
  library: CaseLibrary,
  endpointId: string,
  caseId: string,
  patch: Partial<Pick<MockCase, 'name' | 'response' | 'delayMs' | 'fault'>>
): CaseLibrary {
  const endpoint = findEndpoint(library, endpointId);
  if (!endpoint) return library;
  const others = endpoint.cases.filter((c) => c.id !== caseId).map((c) => c.name);
  return withEndpoint(library, {
    ...endpoint,
    cases: endpoint.cases.map((c) => {
      if (c.id !== caseId) return c;
      const next: MockCase = { ...c, ...patch };
      if (patch.name !== undefined) next.name = uniqueName(patch.name.trim() || c.name, others);
      if (!next.delayMs) delete next.delayMs;
      if (!next.fault || next.fault === 'none') delete next.fault;
      return next;
    })
  });
}

/** 케이스를 참조하는 시나리오 이름들(직접 선택한 것만). */
export function caseUsers(scenarios: readonly ScenarioV2[], endpointId: string, caseId: string): string[] {
  return scenarios
    .filter((s) => s.picks.some((p) => p.endpointId === endpointId && p.caseId === caseId))
    .map((s) => s.name);
}

/**
 * 케이스를 삭제하고, 그 케이스를 고른 시나리오의 선택은 함께 제거한다.
 * 마지막 케이스를 지우면 엔드포인트도 사라진다. affected는 영향받은 시나리오 이름(확인 대화상자용).
 */
export function removeCase(
  library: CaseLibrary,
  scenarios: readonly ScenarioV2[],
  endpointId: string,
  caseId: string
): { library: CaseLibrary; scenarios: ScenarioV2[]; affected: string[] } {
  const endpoint = findEndpoint(library, endpointId);
  if (!endpoint) return { library, scenarios: [...scenarios], affected: [] };
  const cases = endpoint.cases.filter((c) => c.id !== caseId);
  const nextLibrary: CaseLibrary = {
    ...library,
    endpoints:
      cases.length === 0
        ? library.endpoints.filter((e) => e.id !== endpointId)
        : library.endpoints.map((e) => (e.id === endpointId ? { ...e, cases } : e))
  };
  const affected = caseUsers(scenarios, endpointId, caseId);
  const nextScenarios = scenarios.map((s) =>
    affected.includes(s.name)
      ? { ...s, picks: s.picks.filter((p) => !(p.endpointId === endpointId && p.caseId === caseId)) }
      : s
  );
  return { library: nextLibrary, scenarios: nextScenarios, affected };
}

// ---------- 시나리오 해석 ----------

export interface EffectivePick {
  caseId: string | null;
  /** 이 선택을 정한 시나리오(자기 자신이면 own, 아니면 상속한 베이스 이름). */
  from: string;
}

/** 베이스 체인(가장 먼 베이스 → 자기 자신). 순환이면 cycle=true로 끊는다. */
function chainOf(name: string, scenarios: readonly ScenarioV2[]): { chain: ScenarioV2[]; cycle: boolean } {
  const byName = new Map(scenarios.map((s) => [s.name, s]));
  const chain: ScenarioV2[] = [];
  const seen = new Set<string>();
  let current = byName.get(name);
  let cycle = false;
  while (current) {
    if (seen.has(current.name)) {
      cycle = true;
      break;
    }
    seen.add(current.name);
    chain.unshift(current);
    current = current.base ? byName.get(current.base) : undefined;
  }
  return { chain, cycle };
}

/** 상속을 반영한 엔드포인트별 최종 선택(편집 화면에서 "상속/덮어씀"을 보여주는 데 쓴다). */
export function effectivePicks(
  name: string,
  scenarios: readonly ScenarioV2[]
): { picks: Map<string, EffectivePick>; cycle: boolean } {
  const { chain, cycle } = chainOf(name, scenarios);
  const picks = new Map<string, EffectivePick>();
  for (const scenario of chain) {
    const from = scenario.name === name ? 'own' : scenario.name;
    for (const pick of scenario.picks) picks.set(pick.endpointId, { caseId: pick.caseId, from });
  }
  return { picks, cycle };
}

export interface ResolvedScenario {
  mocks: MockDefinition[];
  /** 라이브러리에 없는 엔드포인트/케이스를 가리키는 선택(`엔드포인트 → 케이스ID`). */
  missing: string[];
  cycle: boolean;
}

/** 케이스를 프록시에 적용할 목 정의로 풀어낸다. */
export function caseToMock(endpoint: LibraryEndpoint, c: MockCase): MockDefinition {
  return {
    id: `${endpoint.id}#${c.id}`,
    label: `${endpoint.method} ${endpoint.path} · ${c.name}`,
    method: endpoint.method,
    path: endpoint.path,
    response: { ...c.response, headers: c.response.headers.map(([k, v]) => [k, v] as [string, string]) },
    enabled: true,
    ...(c.delayMs ? { delayMs: c.delayMs } : {}),
    ...(c.fault ? { fault: c.fault } : {}),
    // 라이브러리 원본 본문 보존: 작업 공간에서 고치면 "수정됨"/diff 대상이 된다.
    originalBody: c.response.body,
    caseRef: { endpointId: endpoint.id, caseId: c.id }
  };
}

/** 시나리오(상속 포함)를 목 정의 목록으로 해석한다. */
export function resolveScenario(
  name: string,
  scenarios: readonly ScenarioV2[],
  library: CaseLibrary
): ResolvedScenario {
  const { picks, cycle } = effectivePicks(name, scenarios);
  const mocks: MockDefinition[] = [];
  const missing: string[] = [];
  for (const [endpointId, pick] of picks) {
    if (pick.caseId === null) continue;
    const endpoint = findEndpoint(library, endpointId);
    const c = endpoint?.cases.find((x) => x.id === pick.caseId);
    if (!endpoint || !c) missing.push(`${endpointId} → ${pick.caseId}`);
    else mocks.push(caseToMock(endpoint, c));
  }
  return { mocks, missing, cycle };
}

// ---------- 작업 공간 ↔ 시나리오 ----------

function sameContent(a: MockDefinition, b: MockDefinition): boolean {
  return contentHash({ response: a.response, delayMs: a.delayMs, fault: a.fault }) ===
    contentHash({ response: b.response, delayMs: b.delayMs, fault: b.fault });
}

export interface WorkspaceDiff {
  dirty: boolean;
  /** 시나리오에 없는데 작업 공간에 있는 엔드포인트. */
  added: string[];
  /** 시나리오에는 있는데 작업 공간에 없거나 꺼진 엔드포인트. */
  removed: string[];
  /** 둘 다 있지만 케이스 또는 내용이 다른 엔드포인트. */
  changed: string[];
}

/** 해석된 시나리오와 지금 작업 공간의 차이(활성 시나리오의 "수정됨" 판정). 꺼진 목은 없는 것으로 본다. */
export function diffWorkspace(resolved: readonly MockDefinition[], workspace: readonly MockDefinition[]): WorkspaceDiff {
  const key = (m: MockDefinition): string => endpointIdOf(m.method, m.path);
  const want = new Map(resolved.map((m) => [key(m), m]));
  const have = new Map(workspace.filter((m) => m.enabled).map((m) => [key(m), m]));
  const added = [...have.keys()].filter((k) => !want.has(k));
  const removed = [...want.keys()].filter((k) => !have.has(k));
  const changed = [...have.keys()].filter((k) => {
    const w = want.get(k);
    return !!w && !sameContent(w, have.get(k)!);
  });
  return { dirty: added.length + removed.length + changed.length > 0, added, removed, changed };
}

/**
 * 작업 공간의 목들로 시나리오(v2)를 만든다. 각 목은 케이스로 라이브러리에 들어간다
 * (내용이 같은 케이스가 있으면 재사용). 꺼진 목은 제외한다.
 * base가 있으면 베이스와 다른 선택만 남기고(덮어쓰기), 베이스에는 있는데 작업 공간에 없는 엔드포인트는 null(끔)로 둔다.
 */
export function scenarioFromWorkspace(
  workspace: readonly MockDefinition[],
  library: CaseLibrary,
  meta: { id: string; name: string; description?: string; tags?: string[]; base?: string },
  scenarios: readonly ScenarioV2[] = []
): { scenario: ScenarioV2; library: CaseLibrary } {
  let lib = library;
  const picks = new Map<string, ScenarioPick>();
  for (const mock of workspace) {
    if (!mock.enabled) continue;
    const result = upsertCase(lib, mock);
    lib = result.library;
    picks.set(result.endpointId, { endpointId: result.endpointId, caseId: result.caseId });
  }
  let finalPicks = [...picks.values()];
  if (meta.base) {
    const inherited = effectivePicks(meta.base, scenarios).picks;
    finalPicks = finalPicks.filter((p) => inherited.get(p.endpointId)?.caseId !== p.caseId);
    for (const [endpointId, pick] of inherited) {
      if (pick.caseId !== null && !picks.has(endpointId)) finalPicks.push({ endpointId, caseId: null });
    }
  }
  return {
    scenario: {
      version: 2,
      id: meta.id,
      name: meta.name,
      ...(meta.description ? { description: meta.description } : {}),
      ...(meta.tags && meta.tags.length > 0 ? { tags: meta.tags } : {}),
      ...(meta.base ? { base: meta.base } : {}),
      picks: finalPicks
    },
    library: lib
  };
}

/** 작업 공간에서 고친 목을 출처 케이스에 반영한다("케이스에 반영"). 출처가 없으면 새 케이스로 저장. */
export function applyMockToCase(
  library: CaseLibrary,
  mock: MockDefinition
): { library: CaseLibrary; endpointId: string; caseId: string } {
  const ref = mock.caseRef;
  if (ref && findCase(library, ref.endpointId, ref.caseId)) {
    return {
      library: updateCase(library, ref.endpointId, ref.caseId, {
        response: mock.response,
        delayMs: mock.delayMs,
        fault: mock.fault
      }),
      endpointId: ref.endpointId,
      caseId: ref.caseId
    };
  }
  const result = upsertCase(library, mock);
  return { library: result.library, endpointId: result.endpointId, caseId: result.caseId };
}

// ---------- v1 변환 ----------

/**
 * 디스크의 시나리오 파일들을 v2로 정규화한다. v1(목 복사본)은 결정적 ID로 라이브러리에 변환한다:
 * 같은 응답은 한 케이스로 합쳐지고, 꺼진 목도 케이스로는 보존하되 선택에서는 뺀다.
 */
export function normalizeScenarios(
  files: readonly ScenarioFile[],
  library: CaseLibrary
): { scenarios: ScenarioV2[]; library: CaseLibrary; migrated: string[] } {
  let lib = library;
  const migrated: string[] = [];
  const scenarios = files.map((file): ScenarioV2 => {
    if (file.version === 2) return file;
    migrated.push(file.name);
    const picks = new Map<string, ScenarioPick>();
    for (const mock of file.mocks) {
      const result = upsertCase(lib, mock);
      lib = result.library;
      if (mock.enabled) picks.set(result.endpointId, { endpointId: result.endpointId, caseId: result.caseId });
    }
    return {
      version: 2,
      id: file.id,
      name: file.name,
      ...(file.description ? { description: file.description } : {}),
      picks: [...picks.values()]
    };
  });
  return { scenarios, library: lib, migrated };
}

/** 디스크에서 읽은 임의의 값을 라이브러리로 안전하게 해석한다(손상/없음은 빈 라이브러리). */
export function parseLibrary(raw: unknown): CaseLibrary {
  const lib = raw as Partial<CaseLibrary> | null;
  if (!lib || lib.version !== 2 || !Array.isArray(lib.endpoints)) return EMPTY_LIBRARY;
  const endpoints = lib.endpoints.filter(
    (e): e is LibraryEndpoint =>
      !!e && typeof e.id === 'string' && typeof e.method === 'string' && typeof e.path === 'string' && Array.isArray(e.cases)
  );
  return { version: 2, endpoints };
}

// ---------- 엣지케이스 프리셋 ----------

export interface CasePreset {
  key: string;
  label: string;
  /** 기준 응답(보통 정상 케이스)을 받아 케이스 내용을 만든다. */
  build: (base?: MockResponse) => CaseContent;
}

const JSON_HEADERS: Array<[string, string]> = [['content-type', 'application/json']];
const jsonError = (status: number, statusMessage: string, error: string, extra: Array<[string, string]> = []): CaseContent => ({
  response: {
    status,
    statusMessage,
    headers: [...JSON_HEADERS, ...extra],
    body: JSON.stringify({ error }, null, 2)
  }
});

/** 자주 쓰는 엣지케이스를 한 번에 케이스로 추가하기 위한 프리셋. */
export const CASE_PRESETS: readonly CasePreset[] = [
  { key: 'server-error', label: '500 서버 오류', build: () => jsonError(500, 'Internal Server Error', 'internal_server_error') },
  { key: 'unauthorized', label: '401 인증 만료', build: () => jsonError(401, 'Unauthorized', 'unauthorized') },
  { key: 'not-found', label: '404 없음', build: () => jsonError(404, 'Not Found', 'not_found') },
  { key: 'rate-limited', label: '429 요청 과다', build: () => jsonError(429, 'Too Many Requests', 'rate_limited', [['retry-after', '1']]) },
  {
    key: 'empty-list',
    label: '빈 목록 (200 [])',
    build: () => ({ response: { status: 200, statusMessage: 'OK', headers: JSON_HEADERS, body: '[]' } })
  },
  {
    key: 'slow',
    label: '느린 응답 (+3초)',
    build: (base) => ({
      response: base ?? { status: 200, statusMessage: 'OK', headers: JSON_HEADERS, body: '{}' },
      delayMs: 3000
    })
  },
  { key: 'timeout', label: '타임아웃', build: () => ({ response: { status: 200, headers: [], body: '' }, fault: 'timeout' }) },
  { key: 'reset', label: '연결 리셋', build: () => ({ response: { status: 200, headers: [], body: '' }, fault: 'reset' }) }
];

/** 프리셋 케이스를 엔드포인트에 추가한다. 기준 응답은 그 엔드포인트의 첫 케이스를 쓴다. */
export function addPresetCase(
  library: CaseLibrary,
  endpointId: string,
  presetKey: string
): { library: CaseLibrary; caseId?: string } {
  const preset = CASE_PRESETS.find((p) => p.key === presetKey);
  const endpoint = findEndpoint(library, endpointId);
  if (!preset || !endpoint) return { library };
  const content = preset.build(endpoint.cases[0]?.response);
  const result = upsertCase(
    library,
    { method: endpoint.method, path: endpoint.path, ...content },
    preset.label
  );
  return { library: result.library, caseId: result.caseId };
}
