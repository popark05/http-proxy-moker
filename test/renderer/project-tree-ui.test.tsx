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

describe('ProjectTree 키보드 탐색', () => {
  const tree = (): HTMLElement => screen.getByRole('tree');
  const focused = (): string => document.activeElement?.textContent?.trim() ?? '';

  it('방향키로 그룹 헤더와 항목을 오가고 오른쪽/왼쪽으로 접고 펼친다', () => {
    setup();
    const mocksHeader = screen.getByRole('button', { name: /^목/ });
    mocksHeader.focus();
    fireEvent.keyDown(mocksHeader, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('role')).toBe('treeitem');
    expect(focused()).toContain('/users');

    // 항목에서 왼쪽 → 소속 그룹 헤더로
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(mocksHeader);
    // 펼친 그룹에서 왼쪽 → 접힘, 오른쪽 → 펼침
    fireEvent.keyDown(mocksHeader, { key: 'ArrowLeft' });
    expect(mocksHeader.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(mocksHeader, { key: 'ArrowRight' });
    expect(mocksHeader.getAttribute('aria-expanded')).toBe('true');
  });

  it('Home/End로 처음과 끝으로 이동한다', () => {
    setup();
    const items = within(tree()).getAllByRole('treeitem');
    items[0].focus();
    fireEvent.keyDown(items[0], { key: 'End' });
    // 보이는 항목 중 마지막은 항목이 없는 마지막 그룹(계약)의 헤더다.
    expect(document.activeElement?.getAttribute('data-group-id')).toBe('contracts');
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement?.getAttribute('data-tree-focus')).toBe('group');
  });

  it('Enter는 기본 동작을, Delete는 삭제를 요청한다', () => {
    const h = setup();
    const scenarioRow = screen.getByText('정상').closest('[role=treeitem]') as HTMLElement;
    scenarioRow.focus();
    fireEvent.keyDown(scenarioRow, { key: 'Enter' });
    expect(h.onActivateScenario).toHaveBeenCalledWith('정상');
    fireEvent.keyDown(scenarioRow, { key: 'Delete' });
    expect(h.onDeleteScenario).toHaveBeenCalledWith('정상');
    // 삭제 동작이 없는 세션 항목은 Delete를 무시한다
    const session = screen.getByText('세션1').closest('[role=treeitem]') as HTMLElement;
    fireEvent.keyDown(session, { key: 'Delete' });
    expect(h.onLoadSession).not.toHaveBeenCalled();
  });

  it('메뉴 키로 연 메뉴는 첫 항목에 포커스가 가고 방향키·Esc가 동작하며 포커스가 돌아온다', () => {
    const h = setup();
    const row = screen.getByText('정상').closest('[role=treeitem]') as HTMLElement;
    row.focus();
    fireEvent.keyDown(row, { key: 'ContextMenu' });
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('활성화');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('편집');
    fireEvent.click(document.activeElement!);
    expect(h.onEditScenario).toHaveBeenCalledWith('정상');
    expect(document.activeElement).toBe(row);
  });

  it('검색창에서 아래 화살표를 누르면 트리 첫 항목으로 내려간다', () => {
    setup();
    const search = screen.getByLabelText('프로젝트 검색');
    search.focus();
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('data-tree-focus')).toBe('group');
  });
});
