import { describe, it, expect } from 'vitest';
import type { MockDefinition, MockScenario } from '../../src/shared/mock';
import {
  CASE_PRESETS,
  EMPTY_LIBRARY,
  addPresetCase,
  applyMockToCase,
  caseUsers,
  diffWorkspace,
  effectivePicks,
  endpointIdOf,
  normalizeScenarios,
  parseLibrary,
  removeCase,
  resolveScenario,
  scenarioFromWorkspace,
  updateCase,
  upsertCase,
  type CaseLibrary,
  type ScenarioV2
} from '../../src/shared/scenario-library';

const mock = (method: string, path: string, status = 200, body = '{"ok":true}', extra: Partial<MockDefinition> = {}): MockDefinition => ({
  id: `m-${method}-${path}-${status}`,
  label: `${method} ${path}`,
  method,
  path,
  enabled: true,
  response: { status, headers: [['content-type', 'application/json']], body },
  ...extra
});

const scenario = (name: string, picks: ScenarioV2['picks'], base?: string): ScenarioV2 => ({
  version: 2,
  id: `s-${name}`,
  name,
  picks,
  ...(base ? { base } : {})
});

describe('upsertCase', () => {
  it('새 엔드포인트/케이스를 만들고 같은 내용은 재사용한다', () => {
    const a = upsertCase(EMPTY_LIBRARY, mock('GET', '/pay'));
    expect(a.created).toBe(true);
    expect(a.endpointId).toBe('GET /pay');
    expect(a.library.endpoints[0].cases[0].name).toBe('200');

    const b = upsertCase(a.library, mock('get', '/pay'));
    expect(b.created).toBe(false);
    expect(b.caseId).toBe(a.caseId);
    expect(b.library.endpoints[0].cases).toHaveLength(1);
  });

  it('다른 내용은 같은 엔드포인트의 새 케이스, 이름이 겹치면 번호를 붙인다', () => {
    let lib = upsertCase(EMPTY_LIBRARY, mock('GET', '/pay', 500, 'a')).library;
    const r = upsertCase(lib, mock('GET', '/pay', 500, 'b'));
    lib = r.library;
    expect(lib.endpoints).toHaveLength(1);
    expect(lib.endpoints[0].cases.map((c) => c.name)).toEqual(['500', '500 (2)']);
  });

  it('지연/에러 주입이 이름과 내용 구분에 반영된다', () => {
    const lib = upsertCase(EMPTY_LIBRARY, mock('GET', '/x', 200, 'b', { delayMs: 3000 })).library;
    const lib2 = upsertCase(lib, mock('GET', '/x', 200, 'b', { fault: 'timeout' })).library;
    expect(lib2.endpoints[0].cases.map((c) => c.name)).toEqual(['200 +3000ms', '타임아웃']);
  });
});

describe('resolveScenario (상속)', () => {
  let lib: CaseLibrary = EMPTY_LIBRARY;
  const add = (m: MockDefinition) => {
    const r = upsertCase(lib, m);
    lib = r.library;
    return { endpointId: r.endpointId, caseId: r.caseId };
  };
  const feedOk = add(mock('GET', '/feed', 200, '[1]'));
  const payOk = add(mock('POST', '/pay', 200, '{"paid":true}'));
  const payFail = add(mock('POST', '/pay', 500, '{"e":1}'));
  const loginOk = add(mock('POST', '/login', 200, '{"t":1}'));

  const base = scenario('정상', [feedOk, payOk, loginOk]);
  const failing = scenario('결제 실패', [payFail], '정상');

  it('베이스를 상속하고 일부만 덮어쓴다', () => {
    const { mocks, missing } = resolveScenario('결제 실패', [base, failing], lib);
    expect(missing).toEqual([]);
    const byPath = Object.fromEntries(mocks.map((m) => [m.path, m.response.status]));
    expect(byPath).toEqual({ '/feed': 200, '/pay': 500, '/login': 200 });
    expect(mocks.every((m) => m.caseRef && m.originalBody !== undefined)).toBe(true);
  });

  it('caseId가 null이면 상속한 엔드포인트를 끈다', () => {
    const noLogin = scenario('로그인 없음', [{ endpointId: 'POST /login', caseId: null }], '정상');
    const { mocks } = resolveScenario('로그인 없음', [base, noLogin], lib);
    expect(mocks.map((m) => m.path).sort()).toEqual(['/feed', '/pay']);
  });

  it('effectivePicks는 어느 시나리오가 정했는지 알려준다', () => {
    const { picks } = effectivePicks('결제 실패', [base, failing]);
    expect(picks.get('POST /pay')).toEqual({ caseId: payFail.caseId, from: 'own' });
    expect(picks.get('GET /feed')?.from).toBe('정상');
  });

  it('순환 상속은 끊고 표시한다', () => {
    const a = scenario('A', [feedOk], 'B');
    const b = scenario('B', [payOk], 'A');
    const r = resolveScenario('A', [a, b], lib);
    expect(r.cycle).toBe(true);
    expect(r.mocks.length).toBe(2);
  });

  it('라이브러리에 없는 참조는 missing으로 알린다', () => {
    const broken = scenario('깨짐', [{ endpointId: 'GET /gone', caseId: 'c-zzz' }]);
    const r = resolveScenario('깨짐', [broken], lib);
    expect(r.mocks).toEqual([]);
    expect(r.missing).toEqual(['GET /gone → c-zzz']);
  });
});

describe('케이스 수정/삭제', () => {
  it('케이스를 고치면 그것을 참조하는 시나리오의 해석 결과가 바뀐다(참조 방식)', () => {
    const r = upsertCase(EMPTY_LIBRARY, mock('GET', '/feed', 200, 'old'));
    const s = scenario('S', [{ endpointId: r.endpointId, caseId: r.caseId }]);
    const lib2 = updateCase(r.library, r.endpointId, r.caseId, {
      response: { status: 200, headers: [], body: 'new' }
    });
    expect(resolveScenario('S', [s], lib2).mocks[0].response.body).toBe('new');
  });

  it('이름을 바꿔도 ID는 유지되어 참조가 끊기지 않는다', () => {
    const r = upsertCase(EMPTY_LIBRARY, mock('GET', '/feed'));
    const lib2 = updateCase(r.library, r.endpointId, r.caseId, { name: '정상 응답' });
    expect(lib2.endpoints[0].cases[0]).toMatchObject({ id: r.caseId, name: '정상 응답' });
  });

  it('케이스 삭제는 사용 시나리오를 알리고 선택을 정리하며, 마지막 케이스면 엔드포인트도 지운다', () => {
    const r = upsertCase(EMPTY_LIBRARY, mock('GET', '/feed'));
    const s1 = scenario('S1', [{ endpointId: r.endpointId, caseId: r.caseId }]);
    const s2 = scenario('S2', []);
    expect(caseUsers([s1, s2], r.endpointId, r.caseId)).toEqual(['S1']);
    const out = removeCase(r.library, [s1, s2], r.endpointId, r.caseId);
    expect(out.affected).toEqual(['S1']);
    expect(out.library.endpoints).toEqual([]);
    expect(out.scenarios[0].picks).toEqual([]);
  });
});

describe('작업 공간 ↔ 시나리오', () => {
  it('scenarioFromWorkspace: 케이스를 라이브러리에 저장하고 참조로 만든다(꺼진 목 제외, 같은 내용은 합침)', () => {
    const ws = [mock('GET', '/a'), mock('GET', '/b'), mock('GET', '/c', 200, 'x', { enabled: false })];
    const first = scenarioFromWorkspace(ws, EMPTY_LIBRARY, { id: 's1', name: '첫째' });
    expect(first.scenario.picks.map((p) => p.endpointId)).toEqual(['GET /a', 'GET /b']);
    // 같은 목으로 두 번째 시나리오를 만들어도 케이스는 늘지 않는다.
    const second = scenarioFromWorkspace(ws, first.library, { id: 's2', name: '둘째' });
    expect(second.library.endpoints.flatMap((e) => e.cases)).toHaveLength(2);
  });

  it('diffWorkspace: 같으면 깨끗, 고치면 changed, 추가/삭제도 감지', () => {
    const r = scenarioFromWorkspace([mock('GET', '/a'), mock('GET', '/b')], EMPTY_LIBRARY, { id: 's', name: 'S' });
    const resolved = resolveScenario('S', [r.scenario], r.library).mocks;
    expect(diffWorkspace(resolved, resolved).dirty).toBe(false);

    const edited = resolved.map((m) => (m.path === '/a' ? { ...m, response: { ...m.response, status: 503 } } : m));
    expect(diffWorkspace(resolved, edited).changed).toEqual(['GET /a']);

    const extra = [...resolved, mock('GET', '/new')];
    expect(diffWorkspace(resolved, extra).added).toEqual(['GET /new']);

    const disabled = resolved.map((m) => (m.path === '/b' ? { ...m, enabled: false } : m));
    expect(diffWorkspace(resolved, disabled).removed).toEqual(['GET /b']);
  });

  it('applyMockToCase: 출처 케이스가 있으면 그 케이스를 갱신, 없으면 새 케이스', () => {
    const r = upsertCase(EMPTY_LIBRARY, mock('GET', '/a', 200, 'old'));
    const resolved = resolveScenario('S', [scenario('S', [{ endpointId: r.endpointId, caseId: r.caseId }])], r.library).mocks[0];
    const edited = { ...resolved, response: { ...resolved.response, body: 'edited' } };
    const out = applyMockToCase(r.library, edited);
    expect(out.caseId).toBe(r.caseId);
    expect(out.library.endpoints[0].cases).toHaveLength(1);
    expect(out.library.endpoints[0].cases[0].response.body).toBe('edited');

    const fresh = applyMockToCase(EMPTY_LIBRARY, mock('GET', '/z'));
    expect(fresh.library.endpoints[0].cases).toHaveLength(1);
  });
});

describe('scenarioFromWorkspace with base', () => {
  it('베이스와 다른 선택만 덮어쓰기로 저장하고, 작업 공간에 없는 상속 엔드포인트는 null로 끈다', () => {
    const baseWs = [mock('GET', '/feed'), mock('POST', '/pay'), mock('POST', '/login')];
    const b = scenarioFromWorkspace(baseWs, EMPTY_LIBRARY, { id: 'b', name: '정상' });
    const ws = [mock('GET', '/feed'), mock('POST', '/pay', 500, '{"e":1}')]; // /login 없음
    const v = scenarioFromWorkspace(ws, b.library, { id: 'v', name: '결제 실패', base: '정상' }, [b.scenario]);
    const picks = Object.fromEntries(v.scenario.picks.map((p) => [p.endpointId, p.caseId === null ? null : 'case']));
    expect(picks).toEqual({ 'POST /pay': 'case', 'POST /login': null });
    const resolved = resolveScenario('결제 실패', [b.scenario, v.scenario], v.library).mocks;
    expect(resolved.map((m) => `${m.method} ${m.path} ${m.response.status}`).sort()).toEqual(['GET /feed 200', 'POST /pay 500']);
  });
});

describe('v1 변환', () => {
  const v1 = (name: string, mocks: MockDefinition[]): MockScenario => ({ version: 1, id: `id-${name}`, name, mocks });

  it('v1 시나리오를 라이브러리 참조(v2)로 변환하고 같은 응답은 한 케이스로 합친다', () => {
    const files = [
      v1('A', [mock('GET', '/a', 200, 'x'), mock('GET', '/b', 500, 'y')]),
      v1('B', [mock('GET', '/a', 200, 'x')])
    ];
    const { scenarios, library, migrated } = normalizeScenarios(files, EMPTY_LIBRARY);
    expect(migrated).toEqual(['A', 'B']);
    expect(library.endpoints.flatMap((e) => e.cases)).toHaveLength(2);
    const a = resolveScenario('A', scenarios, library).mocks;
    expect(a.map((m) => `${m.method} ${m.path} ${m.response.status}`).sort()).toEqual(['GET /a 200', 'GET /b 500']);
    // 두 시나리오가 같은 케이스를 참조(복사가 아님).
    expect(scenarios[0].picks[0].caseId).toBe(scenarios[1].picks[0].caseId);
  });

  it('변환은 결정적이다(같은 입력 → 같은 ID)', () => {
    const files = [v1('A', [mock('GET', '/a', 200, 'x')])];
    const one = normalizeScenarios(files, EMPTY_LIBRARY);
    const two = normalizeScenarios(files, EMPTY_LIBRARY);
    expect(two.scenarios).toEqual(one.scenarios);
    expect(two.library).toEqual(one.library);
  });

  it('꺼진 목은 케이스로 보존하되 선택에서는 뺀다. v2는 그대로 통과', () => {
    const v2 = scenario('V2', []);
    const { scenarios, library, migrated } = normalizeScenarios(
      [v1('A', [mock('GET', '/a', 200, 'x', { enabled: false })]), v2],
      EMPTY_LIBRARY
    );
    expect(scenarios[0].picks).toEqual([]);
    expect(library.endpoints).toHaveLength(1);
    expect(scenarios[1]).toBe(v2);
    expect(migrated).toEqual(['A']);
  });
});

describe('프리셋/파싱', () => {
  it('addPresetCase: 엔드포인트에 엣지케이스 추가(느린 응답은 정상 응답을 기준으로)', () => {
    const r = upsertCase(EMPTY_LIBRARY, mock('GET', '/feed', 200, '[1,2]'));
    const slow = addPresetCase(r.library, r.endpointId, 'slow');
    const c = slow.library.endpoints[0].cases.find((x) => x.id === slow.caseId)!;
    expect(c.delayMs).toBe(3000);
    expect(c.response.body).toBe('[1,2]');
    const err = addPresetCase(slow.library, r.endpointId, 'server-error');
    expect(err.library.endpoints[0].cases.map((x) => x.name)).toEqual(['200', '느린 응답 (+3초)', '500 서버 오류']);
  });

  it('프리셋이 모두 유효한 케이스를 만든다', () => {
    const r = upsertCase(EMPTY_LIBRARY, mock('GET', '/feed'));
    let lib = r.library;
    for (const p of CASE_PRESETS) lib = addPresetCase(lib, r.endpointId, p.key).library;
    expect(lib.endpoints[0].cases).toHaveLength(1 + CASE_PRESETS.length);
  });

  it('parseLibrary: 손상/없음은 빈 라이브러리', () => {
    expect(parseLibrary(null)).toEqual(EMPTY_LIBRARY);
    expect(parseLibrary({ version: 1 })).toEqual(EMPTY_LIBRARY);
    expect(parseLibrary({ version: 2, endpoints: [{ id: 'GET /a', method: 'GET', path: '/a', cases: [] }, 3] }).endpoints).toHaveLength(1);
    expect(endpointIdOf('post', '/x')).toBe('POST /x');
  });
});
