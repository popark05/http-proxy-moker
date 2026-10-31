import { describe, expect, it } from 'vitest';
import { buildProjectTree } from '../../src/renderer/src/lib/project-tree';
import type { ProjectTreeInput } from '../../src/renderer/src/lib/project-tree';
import type { ScenarioV2 } from '../../src/shared/scenario-library';

const scenario = (name: string, base?: string): ScenarioV2 => ({ version: 2, id: name, name, base, picks: [] });

const base = (over: Partial<ProjectTreeInput> = {}): ProjectTreeInput => ({
  hasProject: true,
  captureSessions: ['세션1', '세션2'],
  scenarios: [scenario('정상'), scenario('장애', '정상')],
  activeScenario: '장애',
  scenarioDirty: true,
  library: {
    version: 2,
    endpoints: [
      {
        id: 'GET /users',
        method: 'GET',
        host: '',
        path: '/users',
        cases: [
          { id: 'c1', name: '정상', response: { status: 200, headers: [], body: '' } },
          { id: 'c2', name: '500 오류', response: { status: 500, headers: [], body: '' } }
        ]
      }
    ]
  },
  ...over
});

describe('buildProjectTree', () => {
  it('프로젝트가 열려 있으면 네 그룹을 순서대로 만든다', () => {
    expect(buildProjectTree(base()).map((g) => [g.id, g.children.length])).toEqual([
      ['sessions', 2],
      ['scenarios', 2],
      ['library', 1]
    ]);
  });

  it('프로젝트가 없으면 저장된 항목이 없으므로 그룹도 없다(목은 목킹 화면에서 다룬다)', () => {
    expect(buildProjectTree(base({ hasProject: false }))).toEqual([]);
  });

  it('활성 시나리오에만 active/dirty를 표시한다', () => {
    const list = buildProjectTree(base()).find((g) => g.id === 'scenarios')!.children;
    expect(list[0]).toMatchObject({ label: '정상', active: false, dirty: false });
    expect(list[1]).toMatchObject({ label: '장애', active: true, dirty: true, base: '정상' });
  });

  it('검색은 맞는 항목만 남기고, 결과 없는 그룹은 숨기되 total은 전체 개수를 유지한다', () => {
    const groups = buildProjectTree(base({ query: '장애' }));
    expect(groups.map((g) => g.id)).toEqual(['scenarios']);
    expect(groups[0].children).toHaveLength(1);
    expect(groups[0].total).toBe(2);
  });

  it('케이스 이름만 맞으면 그 케이스만, 엔드포인트가 맞으면 케이스 전부를 보여 준다', () => {
    const byCase = buildProjectTree(base({ query: '500' })).find((g) => g.id === 'library')!;
    expect(byCase.children[0]).toMatchObject({ kind: 'endpoint' });
    expect((byCase.children[0] as { children: unknown[] }).children).toHaveLength(1);
    const byEndpoint = buildProjectTree(base({ query: '/users' })).find((g) => g.id === 'library')!;
    expect((byEndpoint.children[0] as { children: unknown[] }).children).toHaveLength(2);
  });

  it('검색어는 대소문자를 구분하지 않는다', () => {
    expect(buildProjectTree(base({ query: 'GET' })).find((g) => g.id === 'library')!.children).toHaveLength(1);
    expect(buildProjectTree(base({ query: 'get' })).find((g) => g.id === 'library')!.children).toHaveLength(1);
  });
});
