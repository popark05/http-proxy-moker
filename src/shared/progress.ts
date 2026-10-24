/**
 * 오래 걸리는 시작/해제 작업(프록시, 기기 인터셉션)의 진행 단계 보고.
 * 작업은 선택적 ProgressReporter로 "지금 하는 일"을 알리고, main이 이를 renderer로 push해 로딩 토스트에 보여 준다.
 */

/** 현재 단계 문구를 알린다(짧은 한국어, 예: "USB 터널 설정 중…"). 보고는 best-effort이며 작업 결과에 영향을 주지 않는다. */
export type ProgressReporter = (step: string) => void;

/** main → renderer로 push되는 진행 이벤트. */
export interface OperationProgress {
  /** 작업 식별자. 아래 operationId*()로 만든다. */
  operation: string;
  step: string;
}

export const operationId = {
  proxyStart: 'proxy:start',
  proxyStop: 'proxy:stop',
  deviceStart: (deviceId: string): string => `device:start:${deviceId}`,
  deviceStop: (deviceId: string): string => `device:stop:${deviceId}`
} as const;
