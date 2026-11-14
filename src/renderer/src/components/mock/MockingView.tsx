import type { ReactNode } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Tooltip } from '@astryxdesign/core/Tooltip';

export type MockingTab = 'mocks' | 'scenarios';

interface MockingViewProps {
  tab: MockingTab;
  onTabChange: (tab: MockingTab) => void;
  /** 탭 옆에 보여 주는 개수. */
  counts: { mocks: number; scenarios: number };
  /** 활성 시나리오 이름과 현재 목 수정 여부. */
  activeScenario: string | undefined;
  scenarioDirty: boolean;
  /** 현재 목(복제 소스 + 목 목록). */
  mocks: ReactNode;
  /** 시나리오(목록 또는 편집기). 응답 케이스는 편집기 안에서 다룬다. */
  scenarios: ReactNode;
}

const TABS: ReadonlyArray<{ id: MockingTab; label: string; count: keyof MockingViewProps['counts'] }> = [
  { id: 'mocks', label: '현재 목', count: 'mocks' },
  { id: 'scenarios', label: '시나리오', count: 'scenarios' }
];

/**
 * 목킹 화면: 지금 프록시에 적용되는 "현재 목"과, 저장해 두고 꺼내 쓰는 "시나리오"를 한 곳에서 다룬다(응답 케이스는 시나리오 편집기 안에서 고른다).
 * 두 패널 모두 언마운트하지 않고 숨기기만 해서, 편집 중인 입력이 탭을 오가도 유지된다.
 */
export function MockingView({
  tab,
  onTabChange,
  counts,
  activeScenario,
  scenarioDirty,
  mocks,
  scenarios
}: MockingViewProps): React.JSX.Element {
  const panels: Record<MockingTab, ReactNode> = { mocks, scenarios };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-3">
        <TabList role="tablist" aria-label="목킹" value={tab} onChange={(v) => onTabChange(v as MockingTab)}>
          {TABS.map(({ id, label, count }) => (
            <Tab
              key={id}
              value={id}
              label={label}
              panelId={`mocking-panel-${id}`}
              endContent={<span className="text-xs text-muted-foreground">{counts[count]}</span>}
            />
          ))}
        </TabList>
        <div className="ml-auto">
          {activeScenario ? (
            <Tooltip content="지금 활성화된 시나리오" hasHoverIndication={false}>
              <Badge variant="warning" label={`활성: ${activeScenario}${scenarioDirty ? ' · 수정됨' : ''}`} />
            </Tooltip>
          ) : (
            <span className="text-xs text-muted-foreground">활성 시나리오 없음</span>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {TABS.map(({ id }) => (
          <div
            key={id}
            id={`mocking-panel-${id}`}
            role="tabpanel"
            aria-labelledby={`mocking-tab-${id}`}
            hidden={tab !== id}
            className="h-full overflow-auto"
          >
            {panels[id]}
          </div>
        ))}
      </div>
    </div>
  );
}
