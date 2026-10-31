import type { ComponentProps } from 'react';
import type { CapturedExchange } from '@shared/capture';
import { FilterBar } from '../traffic/FilterBar';
import { SelectionBar } from '../traffic/SelectionBar';
import { TrafficGroupList } from '../traffic/TrafficGroupList';
import { TrafficList } from '../traffic/TrafficList';

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
  onCloneChecked: () => void;
  onSaveContracts: () => void;
  onExportBruno: () => void;
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
  onCloneChecked,
  onSaveContracts,
  onExportBruno
}: TrafficPanelProps): JSX.Element {
  // 삭제(전체 비우기 등)로 사라진 id는 세지 않는다.
  const checkedTotal = exchanges.filter((e) => checkedIds.has(e.id)).length;
  const checkedShown = filtered.filter((e) => checkedIds.has(e.id)).length;

  return (
    <div className="flex h-full flex-col">
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
        onCloneChecked={onCloneChecked}
        onSaveContracts={onSaveContracts}
        onExportBruno={onExportBruno}
        view={view}
        onViewChange={onViewChange}
      />
      <div className="min-h-0 flex-1">
        {view === 'group' ? (
          <TrafficGroupList
            exchanges={filtered}
            selectedId={selectedId}
            onSelect={onSelect}
            checkedIds={checkedIds}
            onCheckedChange={setCheckedIds}
          />
        ) : (
          <TrafficList
            exchanges={filtered}
            selectedId={selectedId}
            onSelect={onSelect}
            checkedIds={checkedIds}
            onCheckedChange={setCheckedIds}
            clientPlatforms={clientPlatforms}
          />
        )}
      </div>
    </div>
  );
}
