import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface SplitPaneProps {
  left: ReactNode;
  right: ReactNode;
  initialLeftWidth?: number;
  minLeftWidth?: number;
  maxLeftWidth?: number;
  /** 지정하면 드래그로 바꾼 좌측 폭을 localStorage에 저장해 다음 실행에 복원한다. */
  widthStorageKey?: string;
  /** true면 좌측을 폭 0으로 접는다(언마운트하지 않아 내부 상태와 스크롤이 유지된다). */
  collapsed?: boolean;
}

function readStoredWidth(key: string | undefined, min: number, max: number): number | undefined {
  if (!key) return undefined;
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? Math.min(max, Math.max(min, value)) : undefined;
  } catch {
    return undefined;
  }
}

function storeWidth(key: string | undefined, width: number): void {
  if (!key) return;
  try {
    localStorage.setItem(key, String(Math.round(width)));
  } catch {
    // 저장소를 못 쓰는 환경이면 이번 실행에서만 유지한다.
  }
}

/** 좌우 2분할 + 드래그 리사이즈. 외부 라이브러리 없이 구현. */
export function SplitPane({
  left,
  right,
  initialLeftWidth = 420,
  minLeftWidth = 260,
  maxLeftWidth = 900,
  widthStorageKey,
  collapsed = false
}: SplitPaneProps): JSX.Element {
  const [leftWidth, setLeftWidth] = useState(
    () => readStoredWidth(widthStorageKey, minLeftWidth, maxLeftWidth) ?? initialLeftWidth
  );
  const containerRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = leftWidth;
      let latest = startWidth;

      const onMove = (moveEvent: MouseEvent): void => {
        const delta = moveEvent.clientX - startX;
        latest = Math.min(maxLeftWidth, Math.max(minLeftWidth, startWidth + delta));
        setLeftWidth(latest);
      };
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        storeWidth(widthStorageKey, latest);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [leftWidth, minLeftWidth, maxLeftWidth, widthStorageKey]
  );

  return (
    <div
      ref={containerRef}
      className="grid h-full w-full overflow-hidden"
      style={{ gridTemplateColumns: collapsed ? '0px 0px 1fr' : `${leftWidth}px 6px 1fr` }}
    >
      <div className="min-h-0 min-w-0 overflow-auto" aria-hidden={collapsed || undefined}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onMouseDown}
        className="cursor-col-resize bg-border transition-colors hover:bg-primary"
        // hidden(display:none)으로 빼면 그리드 칸이 밀려 오른쪽 내용이 폭 0인 칸에 들어간다. 자리는 두고 보이지만 않게 한다.
        style={collapsed ? { visibility: 'hidden' } : undefined}
      />
      <div className="min-h-0 min-w-0 overflow-auto">{right}</div>
    </div>
  );
}
