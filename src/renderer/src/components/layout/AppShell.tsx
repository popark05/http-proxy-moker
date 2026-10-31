import type { ReactNode } from 'react';
import { SplitPane } from '../primitives';
import { Rail } from './Rail';
import { FULL_VIEW_SECTIONS, type SidebarSection } from './sidebar-sections';

interface AppShellProps {
  section: SidebarSection;
  collapsed: boolean;
  onToggleSection: (section: SidebarSection) => void;
  sidebar: ReactNode;
  workspace: ReactNode;
  /** 기기 연결 섹션이 열려 있을 때 사이드바와 워크스페이스 자리를 모두 차지하는 화면. */
  connectView: ReactNode;
  /** 컬렉션 섹션이 열려 있을 때의 전체 화면. */
  collectionView: ReactNode;
}

/**
 * Rail + 사이드바 + 워크스페이스. 사이드바 폭은 SplitPane이 저장한다.
 * 기기 연결·컬렉션 섹션은 전체 화면을 쓴다. 어느 화면도 언마운트하지 않고 숨기기만 해서,
 * 인터셉트 상태(기기 연결), 편집 중인 요청(컬렉션), 열어 둔 편집기 입력(워크스페이스)이 섹션을 오가도 유지된다.
 */
export function AppShell({
  section,
  collapsed,
  onToggleSection,
  sidebar,
  workspace,
  connectView,
  collectionView
}: AppShellProps): JSX.Element {
  const fullView = FULL_VIEW_SECTIONS.has(section) && !collapsed;
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
      <main aria-label="기기 연결" className="min-w-0 flex-1 overflow-auto" hidden={!(fullView && section === 'connect')}>
        {connectView}
      </main>
      <main aria-label="컬렉션" className="min-h-0 min-w-0 flex-1" hidden={!(fullView && section === 'collection')}>
        {collectionView}
      </main>
    </div>
  );
}
