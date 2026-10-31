import { useCallback, useState } from 'react';
import type { SidebarSection } from '../components/layout/sidebar-sections';

const SECTION_KEY = 'evermock.sidebar.section';
const COLLAPSED_KEY = 'evermock.sidebar.collapsed';
const SECTIONS: readonly SidebarSection[] = ['traffic', 'connect'];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 저장소를 못 쓰는 환경이면 이번 실행에서만 유지한다.
  }
}

/** 사이드바의 현재 섹션과 접힘 상태. 다음 실행에도 복원되도록 localStorage에 저장한다. */
export function useSidebarLayout() {
  const [section, setSection] = useState<SidebarSection>(() => {
    const stored = read(SECTION_KEY) as SidebarSection | null;
    return stored && SECTIONS.includes(stored) ? stored : 'traffic';
  });
  const [collapsed, setCollapsed] = useState(() => read(COLLAPSED_KEY) === '1');

  const applyCollapsed = useCallback((next: boolean) => {
    setCollapsed(next);
    write(COLLAPSED_KEY, next ? '1' : '0');
  }, []);

  /** 섹션을 열고 사이드바를 펼친다(상태바 등 다른 곳에서 부를 때). */
  const openSection = useCallback(
    (next: SidebarSection) => {
      setSection(next);
      write(SECTION_KEY, next);
      applyCollapsed(false);
    },
    [applyCollapsed]
  );

  /** Rail 클릭: 열려 있는 섹션을 다시 누르면 접고, 아니면 그 섹션을 연다. */
  const toggleSection = useCallback(
    (next: SidebarSection) => {
      if (!collapsed && next === section) applyCollapsed(true);
      else openSection(next);
    },
    [collapsed, section, applyCollapsed, openSection]
  );

  return { section, collapsed, openSection, toggleSection };
}
