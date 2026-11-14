import type { ReactNode } from 'react';
import { AppShell } from '@astryxdesign/core/AppShell';
import { SplitPane } from '../primitives';
import { SectionNav } from './SectionNav';
import { FULL_VIEW_SECTIONS, type SidebarSection } from './sidebar-sections';

/** 전체 화면을 쓰는 섹션과 접근성 이름. */
const FULL_VIEW_LABEL: Partial<Record<SidebarSection, string>> = {
  connect: '기기 연결',
  mocking: '목킹',
  collection: '컬렉션'
};

interface AppFrameProps {
  /** 상단 내비게이션(TopBar). */
  topNav: ReactNode;
  /** 맨 아래 상태바. */
  statusBar: ReactNode;
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
 * 앱 프레임: Astryx AppShell(상단 내비 + 섹션 내비 + 본문)에 사이드바 + 워크스페이스를 얹는다. 사이드바 폭은 SplitPane이 저장한다.
 * <main>은 AppShell이 하나만 그린다(두 번째 main은 랜드마크를 모호하게 하므로 전체 화면들은 section으로 둔다).
 * 기기 연결·목킹·컬렉션 섹션은 전체 화면을 쓴다. 어느 화면도 언마운트하지 않고 숨기기만 해서,
 * 인터셉트 상태(기기 연결), 편집 중인 목·시나리오(목킹), 편집 중인 요청(컬렉션)이 섹션을 오가도 유지된다.
 */
export function AppFrame({
  topNav,
  statusBar,
  section,
  collapsed,
  onToggleSection,
  sidebar,
  workspace,
  connectView,
  mockingView,
  collectionView
}: AppFrameProps): React.JSX.Element {
  const fullView = FULL_VIEW_SECTIONS.has(section) && !collapsed;
  const views: Array<[SidebarSection, ReactNode]> = [
    ['connect', connectView],
    ['mocking', mockingView],
    ['collection', collectionView]
  ];
  return (
    <AppShell
      topNav={topNav}
      sideNav={<SectionNav section={section} collapsed={collapsed} onSelect={onToggleSection} />}
      // 데스크탑 앱이라 모바일 드로어는 쓰지 않는다.
      mobileNav={false}
      variant="section"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1" hidden={fullView}>
            <SplitPane
              initialLeftWidth={380}
              widthStorageKey="evermock.sidebar.width"
              collapsed={collapsed}
              left={sidebar}
              right={<div className="h-full">{workspace}</div>}
            />
          </div>
          {views.map(([id, node]) => (
            <section
              key={id}
              aria-label={FULL_VIEW_LABEL[id]}
              className="min-h-0 min-w-0 flex-1 overflow-auto"
              hidden={!(fullView && section === id)}
            >
              {node}
            </section>
          ))}
        </div>
        {statusBar}
      </div>
    </AppShell>
  );
}
