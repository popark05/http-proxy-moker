import { Copy, Layers, List } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SelectionBarProps {
  /** 현재 필터로 보이는 요청 수. */
  shownCount: number;
  /** 보이는 요청 중 체크된 수. */
  checkedShownCount: number;
  /** 전체(필터 무관) 중 체크된 수 = 복제 대상 수. */
  checkedCount: number;
  onToggleAllShown: () => void;
  onClear: () => void;
  onCloneChecked: () => void;
  /** 목록 보기 방식: 호스트 그룹 / 시간순 평면. */
  view: 'group' | 'flat';
  onViewChange: (view: 'group' | 'flat') => void;
}

/** 트래픽 목록 위의 다중 선택 바: 보이는 항목 전체 선택 + 선택 항목 일괄 복제. */
export function SelectionBar({
  shownCount,
  checkedShownCount,
  checkedCount,
  onToggleAllShown,
  onClear,
  onCloneChecked,
  view,
  onViewChange
}: SelectionBarProps): JSX.Element | null {
  if (shownCount === 0) return null;
  const allShown = checkedShownCount === shownCount;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          aria-label="보이는 요청 전체 선택"
          checked={allShown}
          ref={(el) => {
            if (el) el.indeterminate = checkedShownCount > 0 && !allShown;
          }}
          onChange={onToggleAllShown}
          className="size-4 cursor-pointer accent-[hsl(var(--primary))]"
        />
        {checkedCount > 0 ? `${checkedCount}개 선택됨` : '전체 선택'}
      </label>
      {checkedCount > 0 && (
        <>
          <Button variant="ghost" size="sm" onClick={onClear}>
            해제
          </Button>
          <div className="flex-1" />
          <Button size="sm" onClick={onCloneChecked}>
            <Copy /> {checkedCount}개 목으로 복제
          </Button>
        </>
      )}
      <div className={checkedCount > 0 ? '' : 'ml-auto'}>
        <ViewToggle view={view} onChange={onViewChange} />
      </div>
    </div>
  );
}

/** 그룹/시간순 보기 전환(아이콘 토글). */
function ViewToggle({
  view,
  onChange
}: {
  view: 'group' | 'flat';
  onChange: (view: 'group' | 'flat') => void;
}): JSX.Element {
  const item = (value: 'group' | 'flat', label: string, Icon: typeof List): JSX.Element => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={view === value}
      title={label}
      onClick={() => onChange(value)}
      className={`flex size-6 items-center justify-center rounded-sm ${
        view === value ? 'bg-accent text-foreground' : 'hover:bg-accent/50'
      }`}
    >
      <Icon className="size-3.5" />
    </button>
  );
  return (
    <div className="flex gap-0.5 rounded-md border border-border p-0.5">
      {item('group', '호스트별 그룹', Layers)}
      {item('flat', '시간순 목록', List)}
    </div>
  );
}
