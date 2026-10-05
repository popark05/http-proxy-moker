import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { MockDefinition } from '../../src/shared/mock';
import type { CaseLibrary, ScenarioFile } from '../../src/shared/scenario-library';
import { EMPTY_LIBRARY } from '../../src/shared/scenario-library';
import { useScenarioLibrary } from '../../src/renderer/src/state/useScenarioLibrary';

const mock = (method: string, path: string, status = 200, body = '{"ok":1}'): MockDefinition => ({
  id: `m-${method}${path}${status}`,
  label: `${method} ${path}`,
  method,
  path,
  enabled: true,
  response: { status, headers: [], body }
});

/** 메모리에 저장하는 가짜 프로젝트 IPC. */
function installApi(initial: { library?: CaseLibrary; scenarios?: ScenarioFile[] } = {}) {
  let library = initial.library ?? EMPTY_LIBRARY;
  const files = new Map<string, ScenarioFile>((initial.scenarios ?? []).map((s) => [s.name, s]));
  const api = {
    loadLibrary: vi.fn(async () => library),
    saveLibrary: vi.fn(async (l: CaseLibrary) => void (library = l)),
    loadAllScenarios: vi.fn(async () => [...files.values()]),
    saveScenario: vi.fn(async (s: ScenarioFile) => {
      files.set(s.name, s);
      return s.name;
    }),
    deleteScenario: vi.fn(async (n: string) => void files.delete(n))
  };
  (window as unknown as { mokerApi: unknown }).mokerApi = { project: api };
  return { api, files, getLibrary: () => library };
}

describe('useScenarioLibrary', () => {
  beforeEach(() => {
    (window as unknown as { mokerApi: unknown }).mokerApi = undefined;
  });

  it('프로젝트가 없으면 비어 있고 IPC를 호출하지 않는다', () => {
    const { api } = installApi();
    const { result } = renderHook(() => useScenarioLibrary({ projectDir: undefined, mocks: [], replaceMocks: () => {} }));
    expect(result.current.scenarios).toEqual([]);
    expect(api.loadLibrary).not.toHaveBeenCalled();
  });

  it('열 때 v1 시나리오를 v2로 변환해 저장하고 개수를 알린다', async () => {
    const { api, files } = installApi({
      scenarios: [{ version: 1, id: 'a', name: 'old', mocks: [mock('GET', '/a'), mock('GET', '/b', 500)] }]
    });
    const { result } = renderHook(() => useScenarioLibrary({ projectDir: '/p', mocks: [], replaceMocks: () => {} }));
    await waitFor(() => expect(result.current.scenarios).toHaveLength(1));
    expect(result.current.migratedCount).toBe(1);
    expect(result.current.library.endpoints).toHaveLength(2);
    expect(api.saveLibrary).toHaveBeenCalled();
    expect((files.get('old') as { version: number }).version).toBe(2);
  });

  it('작업 공간을 시나리오로 저장하고, 활성화하면 케이스가 목으로 풀려 작업 공간을 교체한다', async () => {
    installApi();
    const replaceMocks = vi.fn();
    const workspace = [mock('GET', '/a'), mock('POST', '/pay', 500)];
    const { result } = renderHook(() => useScenarioLibrary({ projectDir: '/p', mocks: workspace, replaceMocks }));
    await waitFor(() => expect(result.current.scenarios).toEqual([]));

    await act(async () => {
      await result.current.saveFromWorkspace('결제 실패');
    });
    expect(result.current.activeScenario).toBe('결제 실패');
    expect(result.current.library.endpoints).toHaveLength(2);

    act(() => void result.current.activate('결제 실패'));
    const applied = replaceMocks.mock.calls.at(-1)![0] as MockDefinition[];
    expect(applied.map((m) => `${m.method} ${m.path} ${m.response.status}`).sort()).toEqual(['GET /a 200', 'POST /pay 500']);
    expect(applied.every((m) => m.caseRef)).toBe(true);
  });

  it('활성 시나리오 이후 작업 공간을 고치면 diff가 dirty가 된다', async () => {
    installApi();
    let workspace = [mock('GET', '/a')];
    const { result, rerender } = renderHook(() => useScenarioLibrary({ projectDir: '/p', mocks: workspace, replaceMocks: () => {} }));
    await waitFor(() => expect(result.current.scenarios).toEqual([]));
    await act(async () => {
      await result.current.saveFromWorkspace('S');
    });
    expect(result.current.diff?.dirty).toBe(false);
    workspace = [mock('GET', '/a', 503)];
    rerender();
    expect(result.current.diff?.changed).toEqual(['GET /a']);
  });

  it('다른 시나리오가 베이스로 쓰는 시나리오는 삭제할 수 없다', async () => {
    const { api } = installApi();
    const { result } = renderHook(() => useScenarioLibrary({ projectDir: '/p', mocks: [mock('GET', '/a')], replaceMocks: () => {} }));
    await waitFor(() => expect(result.current.scenarios).toEqual([]));
    await act(async () => {
      await result.current.saveFromWorkspace('정상');
    });
    await act(async () => {
      await result.current.saveScenario({ version: 2, id: 'v', name: '변형', base: '정상', picks: [] });
    });
    await expect(result.current.deleteScenario('정상')).rejects.toThrow(/베이스로 사용 중/);
    expect(api.deleteScenario).not.toHaveBeenCalled();
  });

  it('작업 공간의 목을 케이스로 저장하면 라이브러리에 들어가고, 출처가 있으면 반영(created=false)', async () => {
    installApi();
    const { result } = renderHook(() => useScenarioLibrary({ projectDir: '/p', mocks: [], replaceMocks: () => {} }));
    await waitFor(() => expect(result.current.scenarios).toEqual([]));
    let first: { created: boolean; caseName: string } | undefined;
    await act(async () => {
      first = await result.current.saveMockAsCase(mock('GET', '/a', 500));
    });
    expect(first).toEqual({ created: true, caseName: '500' });
    const stored = result.current.library.endpoints[0];
    const again = { ...mock('GET', '/a', 500, 'edited'), caseRef: { endpointId: stored.id, caseId: stored.cases[0].id } };
    await act(async () => {
      first = await result.current.saveMockAsCase(again);
    });
    expect(first?.created).toBe(false);
    expect(result.current.library.endpoints[0].cases[0].response.body).toBe('edited');
  });
});
