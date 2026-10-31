import type { ReactNode } from 'react';
import { PanelsTopLeft } from 'lucide-react';
import type { Tab } from '../../lib/workbench';
import { EmptyState } from '../common/EmptyState';
import { TabBar } from './TabBar';
import { panelId, tabId } from './tab-ids';
import type { ComponentProps } from 'react';

interface WorkspaceProps {
  tabs: Tab[];
  activeKey: string | undefined;
  tabBarProps: Omit<ComponentProps<typeof TabBar>, 'tabs' | 'activeKey'>;
  /**
   * 탭 내용. 요청 상세는 활성일 때만 그리지만, 편집 화면(목·시나리오·라이브러리·계약)은
   * 다른 탭으로 옮겨도 입력 중인 내용이 사라지지 않도록 숨긴 채 유지한다.
   */
  renderContent: (tab: Tab) => ReactNode;
  /** 열린 탭이 없을 때 보여 줄 안내 문구(지금 상황에 맞는 다음 행동). */
  emptyDescription?: string;
  /** 열린 탭이 없을 때 보여 줄 안내의 행동 영역. */
  emptyAction?: ReactNode;
  /** 빈 상태 아래에 흐리게 보여 줄 단축키 안내. */
  emptyHint?: ReactNode;
}

/** 탭 줄 + 활성 탭 내용. 탭이 없으면 빈 상태를 보여 준다. */
export function Workspace({ tabs, activeKey, tabBarProps, renderContent, emptyDescription, emptyAction, emptyHint }: WorkspaceProps): JSX.Element {
  if (tabs.length === 0) {
    return (
      <div className="relative flex h-full items-center justify-center">
        <EmptyState
          icon={PanelsTopLeft}
          title="열린 탭이 없습니다"
          description={emptyDescription ?? '왼쪽 트래픽 목록에서 요청을 선택하면 여기에 상세가 열립니다.'}
          action={emptyAction}
        />
        {emptyHint && <p className="absolute bottom-6 text-xs text-muted-foreground">{emptyHint}</p>}
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <TabBar tabs={tabs} activeKey={activeKey} {...tabBarProps} />
      <div className="min-h-0 flex-1">
        {tabs.map((tab) => {
          const active = tab.key === activeKey;
          if (!active && tab.target.kind === 'exchange') return null;
          return (
            <div
              key={tab.key}
              id={panelId(tab.key)}
              role="tabpanel"
              aria-labelledby={tabId(tab.key)}
              hidden={!active}
              className="h-full overflow-auto"
            >
              {renderContent(tab)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
