/**
 * 사이드바 프로젝트 트리 모델(순수 함수). 화면과 무관하게 묶기·개수·검색 규칙을 단위 테스트로 고정한다.
 */
import type { Contract } from '@shared/contract';
import type { MockDefinition } from '@shared/mock';
import type { CaseLibrary, ScenarioV2 } from '@shared/scenario-library';

export type GroupId = 'sessions' | 'mocks' | 'scenarios' | 'library' | 'contracts';

export type TreeNode =
  | { kind: 'session'; key: string; label: string }
  | { kind: 'mock'; key: string; label: string; method: string; path: string; enabled: boolean; hits: number }
  | { kind: 'scenario'; key: string; label: string; active: boolean; dirty: boolean; base?: string }
  | { kind: 'endpoint'; key: string; label: string; method: string; path: string; children: TreeNode[] }
  | { kind: 'case'; key: string; label: string }
  | { kind: 'contract'; key: string; label: string; method: string };

export interface TreeGroup {
  id: GroupId;
  label: string;
  /** 검색으로 걸러지기 전 전체 개수. */
  total: number;
  children: TreeNode[];
}

export interface ProjectTreeInput {
  /** 프로젝트가 열려 있을 때만 세션/시나리오/라이브러리/계약을 보여 준다. 목은 메모리 작업 공간이라 항상 보인다. */
  hasProject: boolean;
  captureSessions: string[];
  mocks: MockDefinition[];
  hitCounts: Record<string, number>;
  scenarios: ScenarioV2[];
  activeScenario: string | undefined;
  /** 활성 시나리오에서 작업 공간이 수정되었는가. */
  scenarioDirty: boolean;
  library: CaseLibrary;
  contracts: Contract[];
  /** 검색어(대소문자 무시). 비어 있으면 전부. */
  query?: string;
}

const matches = (query: string, ...texts: string[]): boolean => texts.some((t) => t.toLowerCase().includes(query));

export function buildProjectTree(input: ProjectTreeInput): TreeGroup[] {
  const query = (input.query ?? '').trim().toLowerCase();
  const keep = (...texts: string[]): boolean => !query || matches(query, ...texts);

  const mocks: TreeNode[] = input.mocks
    .filter((m) => keep(m.label, m.method, m.path))
    .map((m) => ({
      kind: 'mock',
      key: `mock:${m.id}`,
      label: m.label || `${m.method} ${m.path}`,
      method: m.method,
      path: m.path,
      enabled: m.enabled,
      hits: input.hitCounts[m.id] ?? 0
    }));

  const groups: TreeGroup[] = [{ id: 'mocks', label: '목', total: input.mocks.length, children: mocks }];
  if (!input.hasProject) return groups.filter((g) => !query || g.children.length > 0);

  const sessions: TreeNode[] = input.captureSessions
    .filter((name) => keep(name))
    .map((name) => ({ kind: 'session', key: `session:${name}`, label: name }));

  const scenarios: TreeNode[] = input.scenarios
    .filter((s) => keep(s.name, ...(s.tags ?? [])))
    .map((s) => {
      const active = s.name === input.activeScenario;
      return { kind: 'scenario', key: `scenario:${s.name}`, label: s.name, active, dirty: active && input.scenarioDirty, base: s.base };
    });

  // 엔드포인트 이름이나 경로가 맞으면 케이스를 모두, 케이스 이름만 맞으면 맞는 케이스만 보여 준다.
  const endpoints: TreeNode[] = [];
  for (const ep of input.library.endpoints) {
    const epMatches = keep(ep.id);
    const cases = ep.cases.filter((c) => epMatches || keep(c.name));
    if (!epMatches && cases.length === 0) continue;
    endpoints.push({
      kind: 'endpoint',
      key: `endpoint:${ep.id}`,
      label: ep.id,
      method: ep.method,
      path: ep.path,
      children: cases.map((c) => ({ kind: 'case', key: `case:${ep.id}:${c.id}`, label: c.name }))
    });
  }

  const contracts: TreeNode[] = input.contracts
    .filter((c) => keep(c.name, c.endpointId))
    .map((c) => ({ kind: 'contract', key: `contract:${c.name}`, label: c.name, method: c.request.method }));

  groups.unshift({ id: 'sessions', label: '캡처 세션', total: input.captureSessions.length, children: sessions });
  groups.push(
    { id: 'scenarios', label: '시나리오', total: input.scenarios.length, children: scenarios },
    { id: 'library', label: '케이스 라이브러리', total: input.library.endpoints.length, children: endpoints },
    { id: 'contracts', label: '계약', total: input.contracts.length, children: contracts }
  );
  // 검색 중에는 결과가 없는 그룹을 숨겨 맞는 것만 보이게 한다.
  return groups.filter((g) => !query || g.children.length > 0);
}
