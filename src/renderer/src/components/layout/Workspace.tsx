import type { ReactNode } from 'react';
import { PanelsTopLeft } from 'lucide-react';
import type { Tab } from '../../lib/workbench';
import { EmptyState } from '../common/EmptyState';
import { TabBar } from './TabBar';
import type { ComponentProps } from 'react';

interface WorkspaceProps {
  tabs: Tab[];
  activeKey: string | undefined;
  tabBarProps: Omit<ComponentProps<typeof TabBar>, 'tabs' | 'activeKey'>;
  /** 활성 탭의 내용. */
  children: ReactNode;
  /** 열린 탭이 없을 때 보여 줄 안내의 행동 영역. */
  emptyAction?: ReactNode;
}

/** 탭 줄 + 활성 탭 내용. 탭이 없으면 빈 상태를 보여 준다. */
export function Workspace({ tabs, activeKey, tabBarProps, children, emptyAction }: WorkspaceProps): JSX.Element {
  if (tabs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={PanelsTopLeft}
          title="열린 탭이 없습니다"
          description="왼쪽 트래픽 목록에서 요청을 선택하면 여기에 상세가 열립니다."
          action={emptyAction}
        />
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <TabBar tabs={tabs} activeKey={activeKey} {...tabBarProps} />
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
