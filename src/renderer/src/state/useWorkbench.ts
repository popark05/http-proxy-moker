import { useCallback, useEffect, useState } from 'react';
import {
  EMPTY_WORKBENCH,
  activateTab,
  closeTab,
  closeTabsWhere,
  cycleTab,
  moveTab,
  openTab,
  pinTab
} from '../lib/workbench';
import type { Tab, TabTarget } from '../lib/workbench';

/**
 * 워크스페이스 탭 상태와 단축키.
 * Cmd/Ctrl+W 탭 닫기, Cmd/Ctrl+Shift+[ / ] 또는 Ctrl+Tab(+Shift) 탭 이동.
 * (macOS 앱 메뉴의 "닫기" 가속키는 main/index.ts에서 빼 두었다. 남겨 두면 창이 먼저 닫힌다.)
 */
export function useWorkbench() {
  const [state, setState] = useState(EMPTY_WORKBENCH);

  const open = useCallback((target: TabTarget, options?: { pin?: boolean }) => setState((s) => openTab(s, target, options)), []);
  const close = useCallback((key: string) => setState((s) => closeTab(s, key)), []);
  const pin = useCallback((key: string) => setState((s) => pinTab(s, key)), []);
  const activate = useCallback((key: string) => setState((s) => activateTab(s, key)), []);
  const cycle = useCallback((direction: 1 | -1) => setState((s) => cycleTab(s, direction)), []);
  const move = useCallback((from: string, to: string) => setState((s) => moveTab(s, from, to)), []);
  const closeWhere = useCallback((predicate: (tab: Tab) => boolean) => setState((s) => closeTabsWhere(s, predicate)), []);

  const activeKey = state.activeKey;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && !e.altKey && e.code === 'KeyW') {
        if (!activeKey) return;
        e.preventDefault();
        close(activeKey);
      } else if (mod && e.shiftKey && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
        e.preventDefault();
        cycle(e.code === 'BracketRight' ? 1 : -1);
      } else if (e.ctrlKey && e.code === 'Tab') {
        e.preventDefault();
        cycle(e.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeKey, close, cycle]);

  return { state, open, close, pin, activate, move, closeWhere };
}
