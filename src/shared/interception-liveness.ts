/**
 * 기기에서 인터셉션이 "지금도" 살아 있는지 추적한다.
 *
 * 에버목은 인터셉트를 시작한 뒤 기기 쪽 변화(companion 앱에서 사용자가 직접 연결 해제, 다른 VPN이 가로챔,
 * 프록시 설정 삭제)를 알 수 없어 화면이 계속 "활성"으로 남았다. 주기적으로 기기를 확인(`observed`)해
 * "한 번이라도 활성이 확인된 뒤 연속으로 비활성"이면 끊긴 것으로 본다. 순수 로직만 둔다(테스트 가능).
 */

/** 기기 확인 결과. unknown은 확인 자체가 실패(adb 오류 등)한 것으로, 상태를 바꾸지 않는다. */
export type InterceptionLiveness = 'active' | 'inactive' | 'unknown';

export interface LivenessTracker {
  /** 활성이 한 번이라도 확인됐는가. 아니면 아직 시작 중/사용자 승인 대기(VPN 허용 팝업)일 수 있다. */
  seenActive: boolean;
  /** 활성 확인 이후 연속으로 비활성이 관찰된 횟수. */
  misses: number;
}

export const INITIAL_LIVENESS: LivenessTracker = { seenActive: false, misses: 0 };

/** 한 번의 순간적인 확인 오류로 끊김을 알리지 않도록, 연속 비활성이 이만큼 관찰돼야 끊긴 것으로 본다. */
export const LOST_AFTER_MISSES = 2;

export function stepLiveness(
  tracker: LivenessTracker,
  observed: InterceptionLiveness
): { tracker: LivenessTracker; lost: boolean } {
  if (observed === 'unknown') return { tracker, lost: false };
  if (observed === 'active') return { tracker: { seenActive: true, misses: 0 }, lost: false };
  // inactive: 활성을 본 적이 없으면 아직 시작/승인 대기 중이므로 끊긴 것이 아니다.
  if (!tracker.seenActive) return { tracker, lost: false };
  const misses = tracker.misses + 1;
  return { tracker: { seenActive: true, misses }, lost: misses >= LOST_AFTER_MISSES };
}
