import { useEffect, useReducer, useRef, type RefObject } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';

/** 한 번 어긋난 뒤 복구를 시도하는 최대 횟수(영역이 실제로 0이어서 비는 경우 무한 반복 방지). */
const MAX_REPAIRS = 5;

/**
 * 가상 스크롤이 "행은 있는데 아무것도 그리지 않는" 상태에 빠지면 스스로 복구한다.
 *
 * 가상 스크롤은 스크롤 위치와 영역 크기를 이벤트(scroll/ResizeObserver)로만 갱신한다. 필터로 목록이 줄거나
 * 레이아웃이 바뀌는 순간 이벤트를 놓치면 내부 상태가 어긋나 보이는 행이 0개가 되고, 사용자가 보기를
 * 전환하거나 필터를 눌러 컴포넌트를 다시 만들기 전까지 빈 화면으로 남는다.
 * 이 훅은 그 상태를 감지하면 DOM의 실제 스크롤 위치/크기를 다시 읽어 맞추고(콘솔에 기록) 다시 그린다.
 */
export function useVirtualBlankGuard(
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  parentRef: RefObject<HTMLDivElement>,
  rowCount: number
): void {
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const attempts = useRef(0);
  const visible = virtualizer.getVirtualItems().length;

  useEffect(() => {
    if (visible > 0 || rowCount === 0) {
      attempts.current = 0;
      return;
    }
    const el = parentRef.current;
    if (!el || attempts.current >= MAX_REPAIRS) return;
    const frame = requestAnimationFrame(() => {
      attempts.current++;
      console.warn('[가상 스크롤] 행이 있는데 그려지지 않아 보정합니다', {
        rowCount,
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight,
        attempt: attempts.current
      });
      virtualizer.scrollOffset = el.scrollTop;
      virtualizer.scrollRect = { width: el.clientWidth, height: el.clientHeight };
      virtualizer.measure();
      forceRender();
    });
    return () => cancelAnimationFrame(frame);
  });
}
