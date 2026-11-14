import type { ReactNode } from 'react';
import { SplitPane } from '../primitives';
import { Rail } from './Rail';
import { FULL_VIEW_SECTIONS, type SidebarSection } from './sidebar-sections';

/** 전체 화면을 쓰는 섹션과 접근성 이름. */
const FULL_VIEW_LABEL: Partial<Record<SidebarSection, string>> = {
  connect: '기기 연결',
  mocking: '목킹',
  collection: '컬렉션'
};

interface AppShellProps {
  section: SidebarSection;
  collapsed: boolean;
  onToggleSection: (section: SidebarSection) => void;
  sidebar: ReactNode;
  workspace: ReactNode;
  /** 기기 연결 섹션의 전체 화면. */
  connectView: ReactNode;
  /** 목킹 섹션의 전체 화면. */
  mockingView: ReactNode;
  /** 컬렉션 섹션의 전체 화면. */
  collectionView: ReactNode;
}

/**
 * Rail + 사이드바 + 워크스페이스. 사이드바 폭은 SplitPane이 저장한다.
 * 기기 연결·목킹·컬렉션 섹션은 전체 화면을 쓴다. 어느 화면도 언마운트하지 않고 숨기기만 해서,
 * 인터셉트 상태(기기 연결), 편집 중인 목·시나리오(목킹), 편집 중인 요청(컬렉션)이 섹션을 오가도 유지된다.
 */
export function AppShell({
  section,
  collapsed,
  onToggleSection,
  sidebar,
  workspace,
  connectView,
  mockingView,
  collectionView
}: AppShellProps): React.JSX.Element {
  const fullView = FULL_VIEW_SECTIONS.has(section) && !collapsed;
  const views: Array<[SidebarSection, ReactNode]> = [
    ['connect', connectView],
    ['mocking', mockingView],
    ['collection', collectionView]
  ];
  return (
    <div className="flex min-h-0 flex-1">
      <Rail section={section} collapsed={collapsed} onSelect={onToggleSection} />
      <div className="min-w-0 flex-1" hidden={fullView}>
        <SplitPane
          initialLeftWidth={380}
          widthStorageKey="evermock.sidebar.width"
          collapsed={collapsed}
          left={sidebar}
          right={<main className="h-full">{workspace}</main>}
        />
      </div>
      {views.map(([id, node]) => (
        <main
          key={id}
          aria-label={FULL_VIEW_LABEL[id]}
          className="min-h-0 min-w-0 flex-1 overflow-auto"
          hidden={!(fullView && section === id)}
        >
          {node}
        </main>
      ))}
    </div>
  );
}
