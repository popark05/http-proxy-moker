import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TabBar } from '../../src/renderer/src/components/layout/TabBar';
import { Workspace } from '../../src/renderer/src/components/layout/Workspace';
import { StatusBar } from '../../src/renderer/src/components/layout/StatusBar';
import type { Tab } from '../../src/renderer/src/lib/workbench';

const tabs: Tab[] = [
  { key: 'exchange:a', target: { kind: 'exchange', id: 'a' }, pinned: true },
  { key: 'scenario:결제 실패', target: { kind: 'scenario', name: '결제 실패' }, pinned: true },
  { key: 'library', target: { kind: 'library' }, pinned: false }
];

function setup(activeKey = 'exchange:a') {
  const handlers = { onActivate: vi.fn(), onClose: vi.fn(), onPin: vi.fn(), onMove: vi.fn() };
  render(<TabBar tabs={tabs} activeKey={activeKey} describe={(t) => ({ label: t.key })} {...handlers} />);
  return handlers;
}

describe('TabBar 접근성', () => {
  it('활성 탭만 Tab 키로 들어오고 나머지는 방향키로 옮긴다', () => {
    setup('scenario:결제 실패');
    const all = screen.getAllByRole('tab');
    expect(all.map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('좌우 방향키는 이웃 탭을 활성화하고 양 끝에서 순환한다', () => {
    const h = setup();
    const [first, , last] = screen.getAllByRole('tab');
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(h.onActivate).toHaveBeenLastCalledWith('scenario:결제 실패');
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(h.onActivate).toHaveBeenLastCalledWith('library');
    fireEvent.keyDown(last, { key: 'Home' });
    expect(h.onActivate).toHaveBeenLastCalledWith('exchange:a');
    fireEvent.keyDown(first, { key: 'End' });
    expect(h.onActivate).toHaveBeenLastCalledWith('library');
  });

  it('Enter/Space는 활성화, Delete는 닫기를 요청한다', () => {
    const h = setup();
    const [first] = screen.getAllByRole('tab');
    fireEvent.keyDown(first, { key: 'Enter' });
    fireEvent.keyDown(first, { key: ' ' });
    expect(h.onActivate).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(first, { key: 'Delete' });
    expect(h.onClose).toHaveBeenCalledWith('exchange:a');
  });

  it('닫기 버튼은 Tab 순서에서 빠지고 이름이 있다', () => {
    setup();
    const close = screen.getByRole('button', { name: 'exchange:a 닫기' });
    expect(close.tabIndex).toBe(-1);
  });
});

describe('Workspace 탭 패널 연결', () => {
  it('각 탭이 자기 패널을 가리키고 패널은 탭 이름으로 레이블된다(키에 공백·한글이 있어도)', () => {
    render(
      <Workspace
        tabs={tabs.slice(1)}
        activeKey="scenario:결제 실패"
        tabBarProps={{ describe: (t) => ({ label: t.key }), onActivate: () => {}, onClose: () => {}, onPin: () => {}, onMove: () => {} }}
        renderContent={(t) => <p>{t.key} 내용</p>}
      />
    );
    const tab = screen.getByRole('tab', { name: /scenario:결제 실패/ });
    const panelId = tab.getAttribute('aria-controls')!;
    expect(panelId).not.toMatch(/\s/);
    const panel = document.getElementById(panelId)!;
    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(tab.id);
  });

  it('빈 상태는 넘겨준 안내·행동·단축키 힌트를 보여 준다', () => {
    render(
      <Workspace
        tabs={[]}
        activeKey={undefined}
        tabBarProps={{ describe: () => ({ label: '' }), onActivate: () => {}, onClose: () => {}, onPin: () => {}, onMove: () => {} }}
        renderContent={() => null}
        emptyDescription="프록시를 시작하세요"
        emptyAction={<button>프록시 시작</button>}
        emptyHint="⌘K 로 검색"
      />
    );
    expect(screen.getByText('프록시를 시작하세요')).toBeTruthy();
    expect(screen.getByRole('button', { name: '프록시 시작' })).toBeTruthy();
    expect(screen.getByText('⌘K 로 검색')).toBeTruthy();
  });
});

describe('StatusBar 접근성', () => {
  it('상태 변화를 알리는 status 영역과 이름 있는 landmark를 가진다', () => {
    render(
      <StatusBar proxy={{ running: true, port: 8080 }} mode="mock" clientCount={1} activeMockCount={0} onOpenConnect={() => {}} />
    );
    expect(screen.getByRole('contentinfo', { name: '상태' })).toBeTruthy();
    const statuses = screen.getAllByRole('status');
    expect(statuses.length).toBeGreaterThanOrEqual(2);
    expect(statuses.some((s) => s.textContent?.includes('활성 목 없음'))).toBe(true);
  });
});
