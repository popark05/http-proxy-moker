import { SideNav, SideNavItem } from '@astryxdesign/core/SideNav';
import { SIDEBAR_SECTIONS } from './sidebar-sections';
import type { SidebarSection } from './sidebar-sections';

interface SectionNavProps {
  section: SidebarSection;
  /** 사이드바가 접혀 있으면 어떤 섹션도 선택된 것으로 보이지 않는다. */
  collapsed: boolean;
  onSelect: (section: SidebarSection) => void;
}

/**
 * 맨 왼쪽 섹션 이동. 기본은 아이콘만 보이는 접힌 상태이고, 토글로 라벨을 펼칠 수 있다.
 * 이미 열린 섹션을 다시 누르면 사이드바가 접힌다(onSelect가 처리).
 */
export function SectionNav({ section, collapsed, onSelect }: SectionNavProps): React.JSX.Element {
  return (
    <SideNav aria-label="섹션" collapsible={{ defaultIsCollapsed: true }}>
      {SIDEBAR_SECTIONS.map(({ id, label, icon }) => (
        <SideNavItem
          key={id}
          label={label}
          icon={icon}
          isSelected={!collapsed && section === id}
          onClick={() => onSelect(id)}
        />
      ))}
    </SideNav>
  );
}
