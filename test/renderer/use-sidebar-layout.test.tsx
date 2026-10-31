import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSidebarLayout } from '../../src/renderer/src/state/useSidebarLayout';

describe('useSidebarLayout', () => {
  beforeEach(() => localStorage.clear());

  it('기본은 트래픽 섹션이 펼쳐진 상태', () => {
    const { result } = renderHook(() => useSidebarLayout());
    expect(result.current.section).toBe('traffic');
    expect(result.current.collapsed).toBe(false);
  });

  it('열려 있는 섹션을 다시 누르면 접고, 접힌 상태에서 누르면 펼친다', () => {
    const { result } = renderHook(() => useSidebarLayout());
    act(() => result.current.toggleSection('traffic'));
    expect(result.current.collapsed).toBe(true);
    act(() => result.current.toggleSection('traffic'));
    expect(result.current.collapsed).toBe(false);
  });

  it('openSection은 접힌 사이드바를 펼치고 섹션을 바꾼다', () => {
    const { result } = renderHook(() => useSidebarLayout());
    act(() => result.current.toggleSection('traffic'));
    act(() => result.current.openSection('connect'));
    expect(result.current).toMatchObject({ section: 'connect', collapsed: false });
  });

  it('다음 실행에 섹션과 접힘 상태를 복원하고, 잘못된 값은 기본값으로 돌린다', () => {
    const first = renderHook(() => useSidebarLayout());
    act(() => first.result.current.openSection('connect'));
    act(() => first.result.current.toggleSection('connect'));
    first.unmount();
    expect(renderHook(() => useSidebarLayout()).result.current).toMatchObject({ section: 'connect', collapsed: true });

    localStorage.setItem('evermock.sidebar.section', 'nope');
    expect(renderHook(() => useSidebarLayout()).result.current.section).toBe('traffic');
  });
});
