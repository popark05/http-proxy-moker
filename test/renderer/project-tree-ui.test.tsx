import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectTree } from '../../src/renderer/src/components/project/ProjectTree';
import type { MockDefinition } from '../../src/shared/mock';
import type { ScenarioV2 } from '../../src/shared/scenario-library';

const mock: MockDefinition = {
  id: 'm1',
  label: 'GET /users',
  method: 'GET',
  path: '/users',
  enabled: true,
  response: { status: 200, headers: [], body: '' }
};
const scenario = (name: string): ScenarioV2 => ({ version: 2, id: name, name, picks: [] });

function setup(over: Record<string, unknown> = {}) {
  const handlers = {
    onOpenMocks: vi.fn(),
    onLoadSession: vi.fn(),
    onToggleMock: vi.fn(),
    onSaveMockAsCase: vi.fn(),
    onRemoveMock: vi.fn(),
    onActivateScenario: vi.fn(),
    onEditScenario: vi.fn(),
    onDeleteScenario: vi.fn(),
    onUpdateActiveScenario: vi.fn(),
    onOpenLibrary: vi.fn(),
    onOpenContracts: vi.fn(),
    onRemoveContract: vi.fn()
  };
  render(
    <ProjectTree
      input={{
        hasProject: true,
        captureSessions: ['세션1'],
        mocks: [mock],
        hitCounts: { m1: 2 },
        scenarios: [scenario('정상'), scenario('장애')],
        activeScenario: '장애',
        scenarioDirty: true,
        library: { version: 2, endpoints: [] },
        contracts: [],
        ...over
      }}
      {...handlers}
    />
  );
  return handlers;
}

describe('ProjectTree', () => {
  it('세션을 누르면 불러오고, 시나리오를 누르면 활성화한다', () => {
    const h = setup();
    fireEvent.click(screen.getByText('세션1'));
    expect(h.onLoadSession).toHaveBeenCalledWith('세션1');
    fireEvent.click(screen.getByText('정상'));
    expect(h.onActivateScenario).toHaveBeenCalledWith('정상');
  });

  it('활성 시나리오에 활성/수정됨 배지와 목에 히트 수를 보여 준다', () => {
    setup();
    expect(screen.getByText('활성')).toBeTruthy();
    expect(screen.getByText('수정됨')).toBeTruthy();
    const row = screen.getByLabelText('GET /users 활성').closest('[role=treeitem]') as HTMLElement;
    expect(within(row).getByText('2')).toBeTruthy();
  });

  it('목의 체크박스는 행 클릭 없이 활성 여부만 바꾼다', () => {
    const h = setup();
    fireEvent.click(screen.getByLabelText('GET /users 활성'));
    expect(h.onToggleMock).toHaveBeenCalledWith('m1', false);
    expect(h.onOpenMocks).not.toHaveBeenCalled();
  });

  it('시나리오 우클릭 메뉴로 편집/삭제한다', () => {
    const h = setup();
    fireEvent.contextMenu(screen.getByText('정상'));
    fireEvent.click(screen.getByRole('menuitem', { name: '편집' }));
    expect(h.onEditScenario).toHaveBeenCalledWith('정상');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.contextMenu(screen.getByText('정상'));
    fireEvent.click(screen.getByRole('menuitem', { name: '삭제' }));
    expect(h.onDeleteScenario).toHaveBeenCalledWith('정상');
  });

  it('활성 시나리오의 메뉴는 "활성화"가 꺼지고 "현재 작업 공간으로 갱신"이 나온다', () => {
    const h = setup();
    fireEvent.contextMenu(screen.getByText('장애'));
    expect((screen.getByRole('menuitem', { name: '활성화' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('menuitem', { name: '현재 작업 공간으로 갱신' }));
    expect(h.onUpdateActiveScenario).toHaveBeenCalled();
  });

  it('Esc로 메뉴가 닫힌다', () => {
    setup();
    fireEvent.contextMenu(screen.getByText('정상'));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('검색하면 맞는 항목만 남고, 프로젝트가 없으면 안내가 나온다', () => {
    setup();
    fireEvent.change(screen.getByLabelText('프로젝트 검색'), { target: { value: '장애' } });
    expect(screen.queryByText('세션1')).toBeNull();
    expect(screen.getByText('장애')).toBeTruthy();
  });

  it('프로젝트가 없으면 목만 보이고 안내 문구가 나온다', () => {
    setup({ hasProject: false });
    expect(screen.queryByText('캡처 세션')).toBeNull();
    expect(screen.getByText(/프로젝트를 열면/)).toBeTruthy();
  });
});
