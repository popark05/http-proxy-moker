import { describe, it, expect } from 'vitest';
import {
  INITIAL_LIVENESS,
  LOST_AFTER_MISSES,
  stepLiveness,
  type InterceptionLiveness,
  type LivenessTracker
} from '../../src/shared/interception-liveness';

/** 관찰 열을 순서대로 적용해 끊김이 처음 감지되는 인덱스(없으면 -1)를 돌려준다. */
function run(observations: InterceptionLiveness[]): number {
  let tracker: LivenessTracker = INITIAL_LIVENESS;
  for (let i = 0; i < observations.length; i++) {
    const step = stepLiveness(tracker, observations[i]);
    tracker = step.tracker;
    if (step.lost) return i;
  }
  return -1;
}

describe('stepLiveness', () => {
  it('활성이 확인된 뒤 연속 비활성이면 끊긴 것(companion에서 직접 Disconnect)', () => {
    expect(run(['active', 'active', 'inactive', 'inactive'])).toBe(3);
    expect(LOST_AFTER_MISSES).toBe(2);
  });

  it('한 번의 비활성은 무시하고, 다시 활성이면 카운트를 되돌린다', () => {
    expect(run(['active', 'inactive', 'active', 'inactive', 'active'])).toBe(-1);
  });

  it('활성을 본 적이 없으면(VPN 허용 팝업 대기 등) 비활성이 계속돼도 끊긴 것이 아니다', () => {
    expect(run(['inactive', 'inactive', 'inactive', 'inactive'])).toBe(-1);
  });

  it('확인 실패(unknown)는 상태를 바꾸지 않는다', () => {
    expect(run(['active', 'inactive', 'unknown', 'unknown', 'inactive'])).toBe(4);
    expect(run(['active', 'unknown', 'unknown', 'unknown'])).toBe(-1);
  });
});
