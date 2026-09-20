import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface SplitPaneProps {
  left: ReactNode;
  right: ReactNode;
  initialLeftWidth?: number;
  minLeftWidth?: number;
  maxLeftWidth?: number;
}

/** 좌우 2분할 + 드래그 리사이즈. 외부 라이브러리 없이 구현. */
export function SplitPane({
  left,
  right,
  initialLeftWidth = 420,
  minLeftWidth = 260,
  maxLeftWidth = 900
}: SplitPaneProps): JSX.Element {
  const [leftWidth, setLeftWidth] = useState(initialLeftWidth);
  const containerRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = leftWidth;

      const onMove = (moveEvent: MouseEvent): void => {
        const delta = moveEvent.clientX - startX;
        const next = Math.min(maxLeftWidth, Math.max(minLeftWidth, startWidth + delta));
        setLeftWidth(next);
      };
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [leftWidth, minLeftWidth, maxLeftWidth]
  );

  return (
    <div
      ref={containerRef}
      className="grid h-full w-full overflow-hidden"
      style={{ gridTemplateColumns: `${leftWidth}px 6px 1fr` }}
    >
      <div className="min-h-0 min-w-0 overflow-auto">{left}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onMouseDown}
        className="cursor-col-resize bg-border transition-colors hover:bg-primary"
      />
      <div className="min-h-0 min-w-0 overflow-auto">{right}</div>
    </div>
  );
}
