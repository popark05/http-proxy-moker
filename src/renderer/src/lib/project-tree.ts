/**
 * 사이드바 프로젝트 트리 모델(순수 함수). 화면과 무관하게 묶기·개수·검색 규칙을 단위 테스트로 고정한다.
 */
import type { CaseLibrary, ScenarioV2 } from '@shared/scenario-library';

export type GroupId = 'scenarios' | 'library';

export type TreeNode =
  | { kind: 'scenario'; key: string; label: string; active: boolean; dirty: boolean; base?: string }
  | { kind: 'endpoint'; key: string; label: string; method: string; host: string; path: string; children: TreeNode[] }
  | { kind: 'case'; key: string; label: string };

export interface TreeGroup {
  id: GroupId;
  label: string;
  /** 검색으로 걸러지기 전 전체 개수. */
  total: number;
  children: TreeNode[];
}

export interface ProjectTreeInput {
  /** 프로젝트가 열려 있을 때만 저장된 항목(시나리오·응답 케이스)이 있다. 저장된 캡처는 트래픽에서 다룬다. 목은 메모리의 현재 목이라 목킹 화면에서 다룬다. */
  hasProject: boolean;
  scenarios: ScenarioV2[];
  activeScenario: string | undefined;
  /** 활성 시나리오에서 현재 목이 수정되었는가. */
  scenarioDirty: boolean;
  library: CaseLibrary;
  /** 검색어(대소문자 무시). 비어 있으면 전부. */
  query?: string;
}

const matches = (query: string, ...texts: string[]): boolean => texts.some((t) => t.toLowerCase().includes(query));

export function buildProjectTree(input: ProjectTreeInput): TreeGroup[] {
  const query = (input.query ?? '').trim().toLowerCase();
  const keep = (...texts: string[]): boolean => !query || matches(query, ...texts);

  if (!input.hasProject) return [];

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
      host: ep.host,
      path: ep.path,
      children: cases.map((c) => ({ kind: 'case', key: `case:${ep.id}:${c.id}`, label: c.name }))
    });
  }

  const groups: TreeGroup[] = [
    { id: 'scenarios', label: '시나리오', total: input.scenarios.length, children: scenarios },
    { id: 'library', label: '응답 케이스', total: input.library.endpoints.length, children: endpoints }
  ];
  // 검색 중에는 결과가 없는 그룹을 숨겨 맞는 것만 보이게 한다.
  return groups.filter((g) => !query || g.children.length > 0);
}
