import type { ReactNode } from 'react';
import { SplitPane } from '../primitives';
import { Rail } from './Rail';
import type { SidebarSection } from './sidebar-sections';

interface AppShellProps {
  section: SidebarSection;
  collapsed: boolean;
  onToggleSection: (section: SidebarSection) => void;
  sidebar: ReactNode;
  workspace: ReactNode;
}

/** Rail + 사이드바 + 워크스페이스. 사이드바 폭은 SplitPane이 저장한다. */
export function AppShell({ section, collapsed, onToggleSection, sidebar, workspace }: AppShellProps): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1">
      <Rail section={section} collapsed={collapsed} onSelect={onToggleSection} />
      <div className="min-w-0 flex-1">
        <SplitPane
          initialLeftWidth={380}
          widthStorageKey="evermock.sidebar.width"
          collapsed={collapsed}
          left={sidebar}
          right={workspace}
        />
      </div>
    </div>
  );
}
