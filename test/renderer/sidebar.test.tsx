import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { TooltipProvider } from '../../src/renderer/src/components/ui/tooltip';
import { AppShell } from '../../src/renderer/src/components/layout/AppShell';
import { SIDEBAR_SECTIONS } from '../../src/renderer/src/components/layout/sidebar-sections';
import type { SidebarSection } from '../../src/renderer/src/components/layout/sidebar-sections';

// 기기 연결 화면은 인터셉트 상태(useDevices)를 들고 있다. 상태가 남는지만 보면 되므로 상태를 가진 대역을 쓴다.
function Connect(): React.JSX.Element {
  const [on, setOn] = useState(false);
  return (
    <button type="button" onClick={() => setOn(true)}>
      {on ? '인터셉트 중' : '인터셉트 시작'}
    </button>
  );
}

function Harness({ section, collapsed = false }: { section: SidebarSection; collapsed?: boolean }): React.JSX.Element {
  return (
    <TooltipProvider>
      <AppShell
        section={section}
        collapsed={collapsed}
        onToggleSection={vi.fn()}
        sidebar={<div>사이드바</div>}
        workspace={<div>워크스페이스</div>}
        connectView={<Connect />}
        mockingView={<div>목킹 화면</div>}
        collectionView={<div>컬렉션 화면</div>}
      />
    </TooltipProvider>
  );
}

describe('AppShell', () => {
  it('Rail의 맨 위는 기기 연결이다', () => {
    expect(SIDEBAR_SECTIONS.map((s) => s.id)).toEqual(['connect', 'traffic', 'mocking', 'collection']);
    render(<Harness section="traffic" />);
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))[0]).toBe('기기 연결');
  });

  it('기기 연결은 사이드바와 워크스페이스 자리를 모두 차지한다', () => {
    render(<Harness section="connect" />);
    expect(screen.getByRole('main', { name: '기기 연결' })).toBeTruthy();
    expect(screen.queryByText('워크스페이스')?.closest('[hidden]')).toBeTruthy();
  });

  it('컬렉션도 전체 화면이고, 연결 화면은 숨겨질 뿐 살아 있다', () => {
    const { rerender } = render(<Harness section="collection" />);
    expect(screen.getByRole('main', { name: '컬렉션' }).hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('main[aria-label="기기 연결"]')?.hasAttribute('hidden')).toBe(true);
    expect(screen.getByText('워크스페이스').closest('[hidden]')).toBeTruthy();
    rerender(<Harness section="traffic" />);
    expect(screen.getByText('컬렉션 화면').closest('[hidden]')).toBeTruthy();
  });

  it('목킹도 전체 화면이고 편집 중인 내용은 섹션을 오가도 유지된다', () => {
    const { rerender } = render(<Harness section="mocking" />);
    expect(screen.getByRole('main', { name: '목킹' }).hasAttribute('hidden')).toBe(false);
    expect(screen.getByText('워크스페이스').closest('[hidden]')).toBeTruthy();
    rerender(<Harness section="traffic" />);
    expect(screen.getByText('목킹 화면').closest('[hidden]')).toBeTruthy(); // 숨겨져 있을 뿐 살아 있다
  });

  it('기기 연결 ↔ 트래픽을 오가도 인터셉트 상태가 초기화되지 않고 워크스페이스도 유지된다', () => {
    const { rerender } = render(<Harness section="connect" />);
    fireEvent.click(screen.getByText('인터셉트 시작'));
    expect(screen.getByText('인터셉트 중')).toBeTruthy();

    rerender(<Harness section="traffic" />);
    expect(screen.getByText('워크스페이스').closest('[hidden]')).toBeNull();
    expect(screen.getByText('인터셉트 중', { exact: true }).closest('[hidden]')).toBeTruthy(); // 숨겨져 있을 뿐 살아 있다

    rerender(<Harness section="connect" />);
    expect(screen.getByText('인터셉트 중').closest('[hidden]')).toBeNull();
  });

  it('사이드바를 접어 두면 기기 연결 섹션이어도 워크스페이스가 보인다', () => {
    render(<Harness section="connect" collapsed />);
    expect(screen.getByText('워크스페이스').closest('[hidden]')).toBeNull();
  });
});
