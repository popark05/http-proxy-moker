import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MockDefinition } from '@shared/mock';
import {
  EMPTY_LIBRARY,
  applyMockToCase,
  diffWorkspace,
  normalizeScenarios,
  resolveScenario,
  scenarioFromWorkspace,
  upsertCase,
  type CaseLibrary,
  type ScenarioV2,
  type WorkspaceDiff
} from '@shared/scenario-library';

function randomId(): string {
  return `sc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface UseScenarioLibraryArgs {
  /** 열린 프로젝트 경로(없으면 라이브러리/시나리오를 쓰지 않는다). */
  projectDir: string | undefined;
  /** 작업 공간(현재 목 목록). 활성 시나리오와의 차이 계산에 쓴다. */
  mocks: MockDefinition[];
  /** 작업 공간을 통째로 교체(시나리오 활성화). */
  replaceMocks: (mocks: MockDefinition[]) => void;
}

export interface ScenarioMeta {
  description?: string;
  tags?: string[];
  base?: string;
}

export interface UseScenarioLibraryResult {
  library: CaseLibrary;
  scenarios: ScenarioV2[];
  activeScenario: string | undefined;
  /** 활성 시나리오와 작업 공간의 차이(활성 시나리오가 없으면 undefined). */
  diff: WorkspaceDiff | undefined;
  /** 시나리오를 작업 공간에 적용. 해석 경고(없는 케이스, 순환 상속)를 반환. */
  activate: (name: string) => { missing: string[]; cycle: boolean };
  /** 작업 공간의 목들을 케이스 참조 시나리오로 저장(같은 이름이면 덮어씀). 저장된 이름 반환. */
  saveFromWorkspace: (name: string, meta?: ScenarioMeta) => Promise<string>;
  /** 활성 시나리오를 현재 작업 공간 내용으로 갱신. */
  updateActiveFromWorkspace: () => Promise<void>;
  /** 편집 화면에서 만든/고친 시나리오 저장. 저장된 이름 반환. */
  saveScenario: (scenario: ScenarioV2) => Promise<string>;
  /** 삭제. 다른 시나리오가 베이스로 쓰면 거절(사용 중인 시나리오 이름 목록을 던진다). */
  deleteScenario: (name: string) => Promise<void>;
  /** 작업 공간의 목을 케이스로 저장하거나(출처가 없으면) 출처 케이스에 반영. created=새 케이스 여부. */
  saveMockAsCase: (mock: MockDefinition) => Promise<{ created: boolean; caseName: string }>;
  /** 라이브러리/시나리오를 통째로 갱신(케이스 편집·삭제·프리셋 추가). 바뀐 시나리오만 저장. */
  commit: (next: { library: CaseLibrary; scenarios?: ScenarioV2[] }) => Promise<void>;
  /** 변환되어 저장된 v1 시나리오 개수(처음 열 때 한 번 알림용). */
  migratedCount: number;
}

/**
 * 케이스 라이브러리와 시나리오(v2) 상태. 프로젝트를 열면 디스크에서 읽고(v1은 v2로 변환해 저장),
 * 모든 변경은 즉시 디스크에 반영한다. 시나리오를 활성화하면 케이스를 목 정의로 풀어 작업 공간에 넣는다.
 */
export function useScenarioLibrary({
  projectDir,
  mocks,
  replaceMocks
}: UseScenarioLibraryArgs): UseScenarioLibraryResult {
  const [library, setLibrary] = useState<CaseLibrary>(EMPTY_LIBRARY);
  const [scenarios, setScenarios] = useState<ScenarioV2[]>([]);
  const [activeScenario, setActiveScenario] = useState<string | undefined>(undefined);
  const [migratedCount, setMigratedCount] = useState(0);

  // 비동기 콜백이 최신 값을 보도록 미러링(스테일 클로저 방지).
  const libraryRef = useRef(library);
  const scenariosRef = useRef(scenarios);
  libraryRef.current = library;
  scenariosRef.current = scenarios;

  // 프로젝트가 바뀌면 다시 읽는다.
  useEffect(() => {
    let cancelled = false;
    setActiveScenario(undefined);
    if (!projectDir) {
      setLibrary(EMPTY_LIBRARY);
      setScenarios([]);
      setMigratedCount(0);
      return;
    }
    void (async () => {
      const [lib, files] = await Promise.all([
        window.mokerApi.project.loadLibrary(),
        window.mokerApi.project.loadAllScenarios()
      ]);
      const normalized = normalizeScenarios(files, lib);
      if (cancelled) return;
      // v1을 v2로 변환했다면 바로 저장한다(원본은 .v1.bak). 결정적 ID라 저장 전에도 같은 결과지만,
      // 이후 케이스를 편집했을 때 옛 파일이 다시 변환되며 어긋나는 일을 막는다.
      if (normalized.migrated.length > 0) {
        await window.mokerApi.project.saveLibrary(normalized.library);
        for (const s of normalized.scenarios.filter((x) => normalized.migrated.includes(x.name))) {
          await window.mokerApi.project.saveScenario(s);
        }
      }
      if (cancelled) return;
      setLibrary(normalized.library);
      setScenarios(normalized.scenarios);
      setMigratedCount(normalized.migrated.length);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectDir]);

  /** 상태 반영 + 디스크 저장. 바뀐 시나리오만 저장한다. 저장된 이름(살균 후)으로 상태를 맞춘다. */
  const persist = useCallback(
    async (nextLibrary: CaseLibrary, nextScenarios: ScenarioV2[], changed: ScenarioV2[]): Promise<Map<string, string>> => {
      await window.mokerApi.project.saveLibrary(nextLibrary);
      const renamed = new Map<string, string>();
      for (const s of changed) {
        const saved = await window.mokerApi.project.saveScenario(s);
        if (saved !== s.name) renamed.set(s.name, saved);
      }
      const finalScenarios = nextScenarios.map((s) =>
        renamed.has(s.name) ? { ...s, name: renamed.get(s.name)! } : s
      );
      setLibrary(nextLibrary);
      setScenarios(finalScenarios);
      libraryRef.current = nextLibrary;
      scenariosRef.current = finalScenarios;
      return renamed;
    },
    []
  );

  const activate = useCallback(
    (name: string) => {
      const resolved = resolveScenario(name, scenariosRef.current, libraryRef.current);
      replaceMocks(resolved.mocks);
      setActiveScenario(name);
      return { missing: resolved.missing, cycle: resolved.cycle };
    },
    [replaceMocks]
  );

  const upsertScenario = (list: ScenarioV2[], s: ScenarioV2): ScenarioV2[] =>
    list.some((x) => x.name === s.name) ? list.map((x) => (x.name === s.name ? s : x)) : [...list, s];

  const saveFromWorkspace = useCallback(
    async (name: string, meta: ScenarioMeta = {}): Promise<string> => {
      const existing = scenariosRef.current.find((s) => s.name === name);
      const { scenario, library: nextLib } = scenarioFromWorkspace(
        mocks,
        libraryRef.current,
        { id: existing?.id ?? randomId(), name, description: meta.description ?? existing?.description, tags: meta.tags ?? existing?.tags, base: meta.base ?? existing?.base },
        scenariosRef.current
      );
      const renamed = await persist(nextLib, upsertScenario(scenariosRef.current, scenario), [scenario]);
      const saved = renamed.get(name) ?? name;
      setActiveScenario(saved);
      return saved;
    },
    [mocks, persist]
  );

  const updateActiveFromWorkspace = useCallback(async () => {
    if (activeScenario) await saveFromWorkspace(activeScenario);
  }, [activeScenario, saveFromWorkspace]);

  const saveScenario = useCallback(
    async (scenario: ScenarioV2): Promise<string> => {
      const renamed = await persist(libraryRef.current, upsertScenario(scenariosRef.current, scenario), [scenario]);
      return renamed.get(scenario.name) ?? scenario.name;
    },
    [persist]
  );

  const deleteScenario = useCallback(
    async (name: string) => {
      const children = scenariosRef.current.filter((s) => s.base === name).map((s) => s.name);
      if (children.length > 0) throw new Error(`다른 시나리오(${children.join(', ')})가 베이스로 사용 중입니다.`);
      await window.mokerApi.project.deleteScenario(name);
      const next = scenariosRef.current.filter((s) => s.name !== name);
      setScenarios(next);
      scenariosRef.current = next;
      setActiveScenario((cur) => (cur === name ? undefined : cur));
    },
    []
  );

  const saveMockAsCase = useCallback(
    async (mock: MockDefinition) => {
      const before = libraryRef.current;
      const refCase = mock.caseRef
        ? before.endpoints.find((e) => e.id === mock.caseRef!.endpointId)?.cases.find((c) => c.id === mock.caseRef!.caseId)
        : undefined;
      const { library: next, endpointId, caseId } = applyMockToCase(before, mock);
      const caseName = next.endpoints.find((e) => e.id === endpointId)?.cases.find((c) => c.id === caseId)?.name ?? '';
      const created = !refCase && upsertCase(before, mock).created;
      await persist(next, scenariosRef.current, []);
      return { created, caseName };
    },
    [persist]
  );

  const commit = useCallback(
    async (next: { library: CaseLibrary; scenarios?: ScenarioV2[] }) => {
      const nextScenarios = next.scenarios ?? scenariosRef.current;
      const changed = nextScenarios.filter((s) => JSON.stringify(s) !== JSON.stringify(scenariosRef.current.find((x) => x.name === s.name)));
      await persist(next.library, nextScenarios, changed);
    },
    [persist]
  );

  const diff = useMemo(() => {
    if (!activeScenario) return undefined;
    return diffWorkspace(resolveScenario(activeScenario, scenarios, library).mocks, mocks);
  }, [activeScenario, scenarios, library, mocks]);

  return {
    library,
    scenarios,
    activeScenario,
    diff,
    activate,
    saveFromWorkspace,
    updateActiveFromWorkspace,
    saveScenario,
    deleteScenario,
    saveMockAsCase,
    commit,
    migratedCount
  };
}
