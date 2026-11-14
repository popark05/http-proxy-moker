import type { ComponentProps } from 'react';
import { History, Radio } from 'lucide-react';
import type { CapturedExchange } from '@shared/capture';
import { FilterBar } from '../traffic/FilterBar';
import { SelectionBar } from '../traffic/SelectionBar';
import { TrafficGroupList } from '../traffic/TrafficGroupList';
import { TrafficList } from '../traffic/TrafficList';
import { Icon } from '@astryxdesign/core/Icon';
import { Button } from '@astryxdesign/core/Button';
import { useContextMenu } from '../primitives/ContextMenu';
import type { CaptureView } from '../../state/useCapture';
import {
  buildRowMenu,
  buildSourceMenu,
  type SourceMenuActions,
  type TrafficMenuActions
} from '../../lib/traffic-menu';

type FilterBarProps = ComponentProps<typeof FilterBar>;
type TrafficView = ComponentProps<typeof SelectionBar>['view'];

interface TrafficPanelProps {
  filterProps: Omit<FilterBarProps, 'total' | 'shown'>;
  exchanges: CapturedExchange[];
  filtered: CapturedExchange[];
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
  checkedIds: Set<string>;
  setCheckedIds: (next: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  view: TrafficView;
  onViewChange: (view: TrafficView) => void;
  clientPlatforms: ComponentProps<typeof TrafficList>['clientPlatforms'];
  /** 우클릭 메뉴 동작(대상 요청을 받는다). */
  rowActions: Omit<TrafficMenuActions, 'patchFilter' | 'setChecked'>;
  /** 지금 보는 대상(실시간 / 저장된 캡처). */
  source: CaptureView;
  /** 실시간 목록 개수(저장·비우기 대상). */
  liveCount: number;
  /** 저장된 캡처를 보는 동안 실시간에 새로 쌓인 요청 수. */
  newLiveCount: number;
  /** 프로젝트에 저장된 캡처 이름. */
  savedNames: string[];
  sourceActions: SourceMenuActions;
}

/** 트래픽 패널(필터 + 선택 바 + 리스트). 캡처/목킹 모드 공용. */
export function TrafficPanel({
  filterProps,
  exchanges,
  filtered,
  selectedId,
  onSelect,
  checkedIds,
  setCheckedIds,
  view,
  onViewChange,
  clientPlatforms,
  rowActions,
  source,
  liveCount,
  newLiveCount,
  savedNames,
  sourceActions
}: TrafficPanelProps): React.JSX.Element {
  const menu = useContextMenu();
  const actions: TrafficMenuActions = {
    ...rowActions,
    patchFilter: filterProps.patchFilter,
    setChecked: (next) => setCheckedIds(next)
  };
  const openRowMenu = (event: React.MouseEvent, row: CapturedExchange[]): void =>
    menu.open(event, buildRowMenu(row, filtered, checkedIds, actions));
  const sourceItems = buildSourceMenu(source, liveCount, savedNames, sourceActions);
  // 삭제(전체 비우기 등)로 사라진 id는 세지 않는다.
  const checkedTotal = exchanges.filter((e) => checkedIds.has(e.id)).length;
  const checkedShown = filtered.filter((e) => checkedIds.has(e.id)).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1">
        <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">보기</span>
        <Button
          label={source.kind === 'live' ? '실시간' : `저장된 캡처: ${source.name}`}
          icon={
            source.kind === 'live' ? (
              <Icon icon={Radio} className="text-[hsl(var(--success))]" />
            ) : (
              <Icon icon={History} />
            )
          }
          variant="ghost"
          size="sm"
          aria-haspopup="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            menu.open(
              { clientX: r.right - 200, clientY: r.bottom + 4, preventDefault: () => {}, stopPropagation: () => {} },
              sourceItems
            );
          }}
        />
      </div>
      {source.kind === 'saved' && (
        <div role="status" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-xs">
          <span className="text-muted-foreground">
            저장된 캡처 &apos;{source.name}&apos; 보는 중 · 실시간 수집은 계속됩니다
            {newLiveCount > 0 ? ` (새 요청 ${newLiveCount}건)` : ''}
          </span>
          <Button
            label="실시간으로 돌아가기"
            icon={<Icon icon={Radio} />}
            variant="secondary"
            size="sm"
            className="ml-auto"
            onClick={sourceActions.backToLive}
          />
        </div>
      )}
      <FilterBar {...filterProps} total={exchanges.length} shown={filtered.length} />
      <SelectionBar
        shownCount={filtered.length}
        checkedShownCount={checkedShown}
        checkedCount={checkedTotal}
        onToggleAllShown={() =>
          setCheckedIds((prev) => {
            const next = new Set(prev);
            for (const e of filtered) {
              if (checkedShown === filtered.length) next.delete(e.id);
              else next.add(e.id);
            }
            return next;
          })
        }
        onClear={() => setCheckedIds(new Set())}
        view={view}
        onViewChange={onViewChange}
      />
      <div className="min-h-0 flex-1" onContextMenu={(e) => menu.open(e, sourceItems)}>
        {view === 'group' ? (
          <TrafficGroupList
            exchanges={filtered}
            selectedId={selectedId}
            onSelect={onSelect}
            checkedIds={checkedIds}
            onCheckedChange={setCheckedIds}
            onRowContextMenu={openRowMenu}
          />
        ) : (
          <TrafficList
            exchanges={filtered}
            selectedId={selectedId}
            onSelect={onSelect}
            checkedIds={checkedIds}
            onCheckedChange={setCheckedIds}
            clientPlatforms={clientPlatforms}
            onRowContextMenu={openRowMenu}
          />
        )}
      </div>
      {menu.element}
    </div>
  );
}
