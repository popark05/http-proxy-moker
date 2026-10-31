import { describe, expect, it } from 'vitest';
import { buildProjectTree } from '../../src/renderer/src/lib/project-tree';
import type { ProjectTreeInput } from '../../src/renderer/src/lib/project-tree';
import type { MockDefinition } from '../../src/shared/mock';
import type { ScenarioV2 } from '../../src/shared/scenario-library';
import type { Contract } from '../../src/shared/contract';

const mock = (id: string, method: string, path: string, enabled = true): MockDefinition => ({
  id,
  label: `${method} ${path}`,
  method,
  path,
  enabled,
  response: { status: 200, headers: [], body: '' }
});

const scenario = (name: string, base?: string): ScenarioV2 => ({ version: 2, id: name, name, base, picks: [] });

const contract = (name: string, method: string): Contract =>
  ({ name, endpointId: `${method} /x`, request: { method } }) as unknown as Contract;

const base = (over: Partial<ProjectTreeInput> = {}): ProjectTreeInput => ({
  hasProject: true,
  captureSessions: ['세션1', '세션2'],
  mocks: [mock('m1', 'GET', '/users'), mock('m2', 'POST', '/login', false)],
  hitCounts: { m1: 3 },
  scenarios: [scenario('정상'), scenario('장애', '정상')],
  activeScenario: '장애',
  scenarioDirty: true,
  library: {
    version: 2,
    endpoints: [
      {
        id: 'GET /users',
        method: 'GET',
        path: '/users',
        cases: [
          { id: 'c1', name: '정상', response: { status: 200, headers: [], body: '' } },
          { id: 'c2', name: '500 오류', response: { status: 500, headers: [], body: '' } }
        ]
      }
    ]
  },
  contracts: [contract('users', 'GET')],
  ...over
});

describe('buildProjectTree', () => {
  it('프로젝트가 열려 있으면 다섯 그룹을 순서대로 만든다', () => {
    expect(buildProjectTree(base()).map((g) => [g.id, g.children.length])).toEqual([
      ['sessions', 2],
      ['mocks', 2],
      ['scenarios', 2],
      ['library', 1],
      ['contracts', 1]
    ]);
  });

  it('프로젝트가 없으면 메모리 작업 공간인 목만 보여 준다', () => {
    expect(buildProjectTree(base({ hasProject: false })).map((g) => g.id)).toEqual(['mocks']);
  });

  it('목은 활성 여부와 히트 수를 담는다', () => {
    const mocks = buildProjectTree(base()).find((g) => g.id === 'mocks')!.children;
    expect(mocks[0]).toMatchObject({ kind: 'mock', enabled: true, hits: 3 });
    expect(mocks[1]).toMatchObject({ enabled: false, hits: 0 });
  });

  it('활성 시나리오에만 active/dirty를 표시한다', () => {
    const list = buildProjectTree(base()).find((g) => g.id === 'scenarios')!.children;
    expect(list[0]).toMatchObject({ label: '정상', active: false, dirty: false });
    expect(list[1]).toMatchObject({ label: '장애', active: true, dirty: true, base: '정상' });
  });

  it('검색은 맞는 항목만 남기고, 결과 없는 그룹은 숨기되 total은 전체 개수를 유지한다', () => {
    const groups = buildProjectTree(base({ query: 'login' }));
    expect(groups.map((g) => g.id)).toEqual(['mocks']);
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
    expect(buildProjectTree(base({ query: 'GET' })).find((g) => g.id === 'mocks')!.children).toHaveLength(1);
    expect(buildProjectTree(base({ query: 'get' })).find((g) => g.id === 'mocks')!.children).toHaveLength(1);
  });
});
