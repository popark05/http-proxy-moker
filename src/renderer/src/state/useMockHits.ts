import { useCallback, useEffect, useState } from 'react';

export interface MockHitState {
  /** mockId별 누적 히트 수. */
  counts: Record<string, number>;
  /** mockId별 마지막 히트 시각(epoch ms). 플래시 애니메이션 트리거용. */
  lastHitAt: Record<string, number>;
  /** 가장 최근에 히트한 시각(TopBar pulse 트리거용). 없으면 0. */
  lastHitOverall: number;
}

/**
 * 프록시의 mock-hit 이벤트를 구독해 목별 히트 카운트/최근 히트 시각을 관리한다.
 * 목킹 모드에서 어떤 목이 실제로 응답했는지 실시간 강조하는 데 사용.
 */
export function useMockHits(): MockHitState & { reset: () => void } {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [lastHitAt, setLastHitAt] = useState<Record<string, number>>({});
  const [lastHitOverall, setLastHitOverall] = useState(0);

  useEffect(() => {
    // 리스너는 마운트 시 1회 등록 — 함수형 업데이트로 최신 상태에 누적한다.
    return window.mokerApi.onCaptureEvent((event) => {
      if (event.type !== 'mock-hit') return;
      setCounts((prev) => ({ ...prev, [event.mockId]: (prev[event.mockId] ?? 0) + 1 }));
      setLastHitAt((prev) => ({ ...prev, [event.mockId]: event.at }));
      setLastHitOverall(event.at);
    });
  }, []);

  const reset = useCallback((): void => {
    setCounts({});
    setLastHitAt({});
    setLastHitOverall(0);
  }, []);

  return { counts, lastHitAt, lastHitOverall, reset };
}
