import { Copy } from 'lucide-react';
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
}

/** 트래픽 목록 위의 다중 선택 바: 보이는 항목 전체 선택 + 선택 항목 일괄 복제. */
export function SelectionBar({
  shownCount,
  checkedShownCount,
  checkedCount,
  onToggleAllShown,
  onClear,
  onCloneChecked
}: SelectionBarProps): JSX.Element | null {
  if (shownCount === 0) return null;
  const allShown = checkedShownCount === shownCount;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
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
    </div>
  );
}
