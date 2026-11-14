import { MoreHorizontal } from 'lucide-react';
import type { CapturedExchange } from '@shared/capture';

interface RowMenuButtonProps {
  /** 메뉴 대상 요청(호스트/엔드포인트 행이면 묶음 전체, 마지막이 최신). */
  target: CapturedExchange[];
  onOpen: (event: React.MouseEvent, row: CapturedExchange[]) => void;
}

/** 트래픽 행 끝의 "⋯" 버튼. 우클릭과 같은 메뉴를 연다(마우스 우클릭이 어려운 환경과 발견성을 위해). */
export function RowMenuButton({ target, onOpen }: RowMenuButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label="요청 메뉴"
      aria-haspopup="menu"
      onClick={(e) => onOpen(e, target)}
      className="mr-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <MoreHorizontal className="size-4" />
    </button>
  );
}
