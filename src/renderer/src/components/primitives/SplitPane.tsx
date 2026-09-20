import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import styled from 'styled-components';

const Container = styled.div<{ $leftWidth: number }>`
  display: grid;
  grid-template-columns: ${({ $leftWidth }) => `${$leftWidth}px 6px 1fr`};
  height: 100%;
  width: 100%;
  overflow: hidden;
`;

const Pane = styled.div`
  overflow: auto;
  min-width: 0;
  min-height: 0;
`;

const Divider = styled.div`
  cursor: col-resize;
  background: ${({ theme }) => theme.borderSubtle};
  transition: background 0.1s ease;

  &:hover {
    background: ${({ theme }) => theme.accent};
  }
`;

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

      const onMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX;
        const next = Math.min(maxLeftWidth, Math.max(minLeftWidth, startWidth + delta));
        setLeftWidth(next);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [leftWidth, minLeftWidth, maxLeftWidth]
  );

  return (
    <Container ref={containerRef} $leftWidth={leftWidth}>
      <Pane>{left}</Pane>
      <Divider role="separator" aria-orientation="vertical" onMouseDown={onMouseDown} />
      <Pane>{right}</Pane>
    </Container>
  );
}
