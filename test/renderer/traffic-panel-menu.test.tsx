import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { CapturedExchange } from '../../src/shared/capture';
import { TrafficPanel } from '../../src/renderer/src/components/layout/TrafficPanel';

// 가상 목록이 jsdom에서도 행을 그리도록 크기를 준다.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 600 });
  Element.prototype.getBoundingClientRect = () => ({ width: 600, height: 600, top: 0, left: 0, right: 600, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
});

const ex = (id: string, path: string): CapturedExchange => ({
  id,
  startedAt: 1,
  request: { method: 'GET', url: `https://api.example.com${path}`, path, headers: [], body: { encoding: 'empty', content: '', byteLength: 0 } },
  response: { statusCode: 200, statusMessage: 'OK', headers: [], body: { encoding: 'empty', content: '', byteLength: 0 } }
});

function setup(exchanges: CapturedExchange[], sessions: string[] = []) {
  const rowActions = { cloneToMock: vi.fn(), saveContracts: vi.fn(), exportBruno: vi.fn(), copy: vi.fn() };
  const sessionActions = { save: vi.fn(), load: vi.fn(), clear: vi.fn() };
  const patchFilter = vi.fn();
  render(
    <TrafficPanel
      filterProps={{ filter: {}, patchFilter, clearFilter: vi.fn(), active: false, hosts: [], tags: [], clients: [] } as never}
      exchanges={exchanges}
      filtered={exchanges}
      selectedId={undefined}
      onSelect={vi.fn()}
      checkedIds={new Set()}
      setCheckedIds={vi.fn()}
      view="flat"
      onViewChange={vi.fn()}
      clientPlatforms={new Map()}
      rowActions={rowActions}
      sessions={sessions}
      sessionActions={sessionActions}
    />
  );
  return { rowActions, sessionActions, patchFilter };
}

describe('TrafficPanel 우클릭/세션 메뉴', () => {
  it('행을 우클릭하면 메뉴가 열리고 목으로 복제가 그 행을 대상으로 호출된다', () => {
    const list = [ex('1', '/users'), ex('2', '/login')];
    const { rowActions } = setup(list);
    fireEvent.contextMenu(screen.getByText('/login').closest('div[class*="border-b"]') as HTMLElement);
    const menu = screen.getByRole('menu');
    // 모든 항목에 아이콘이 있다.
    const rows = within(menu).getAllByRole('menuitem');
    expect(rows.length).toBeGreaterThan(4);
    for (const row of rows) expect(row.querySelector('svg')).toBeTruthy();
    fireEvent.click(within(menu).getByText('목으로 복제'));
    expect(rowActions.cloneToMock).toHaveBeenCalledWith([list[1]]);
  });

  it('세션 버튼은 저장·불러오기·비우기를 보여 준다', () => {
    const { sessionActions } = setup([ex('1', '/users')], ['어제']);
    fireEvent.click(screen.getByText('세션'));
    const menu = screen.getByRole('menu');
    fireEvent.click(within(menu).getByText('불러오기: 어제'));
    expect(sessionActions.load).toHaveBeenCalledWith('어제');
    fireEvent.click(screen.getByText('세션'));
    fireEvent.click(within(screen.getByRole('menu')).getByText('캡처 세션으로 저장'));
    expect(sessionActions.save).toHaveBeenCalled();
  });
});
