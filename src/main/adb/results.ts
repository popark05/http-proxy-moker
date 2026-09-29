/**
 * 작업 결과 타입. dadb InstallResult/SyncResult/UninstallResult/RootResult/AdbOperationFailedException 이식
 * (Apache-2.0, NOTICE 참고).
 *
 * dadb 설계: 전송 실패는 AdbException으로 throw, 작업 결과(설치 거부, 파일 없음 등)는 값으로 반환.
 * 호출자가 원하면 orThrow()로 예외로 바꿀 수 있지만, 그 예외는 AdbException이 아니다
 * (재연결용 catch(AdbException)에 걸리지 않도록 두 축을 분리).
 */

export type OperationResult = { success: true } | { success: false; reason: string };

/** push/pull 결과. reason은 adbd sync FAIL 메시지. */
export type SyncResult = OperationResult;

/** install/installMultiple 결과. reason은 pm의 응답 원문(INSTALL_FAILED_* 파싱 안 함 — adb와 동일). */
export type InstallResult = OperationResult;

/** root/unroot 결과. reason은 adbd의 root:/unroot: 응답 줄. */
export type RootResult = OperationResult;

/** uninstall 결과. 셸로 실행하므로 실패 시 프로세스 종료 코드를 함께 준다. */
export type UninstallResult =
  | { success: true }
  | { success: false; reason: string; exitCode: number };

export const SUCCESS = { success: true } as const;

export function failure(reason: string): { success: false; reason: string } {
  return { success: false, reason };
}

/** 작업 결과를 호출자 선택으로 예외화한 것. 전송 오류가 아니므로 AdbException이 아니다. */
export class AdbOperationFailedException extends Error {
  constructor(
    readonly reason: string,
    readonly exitCode?: number
  ) {
    super(exitCode !== undefined ? `작업 실패(exit ${exitCode}): ${reason}` : `작업 실패: ${reason}`);
    this.name = 'AdbOperationFailedException';
  }
}

/** 실패 결과면 AdbOperationFailedException을 던진다. */
export function orThrow(result: OperationResult | UninstallResult): void {
  if (result.success) return;
  throw new AdbOperationFailedException(
    result.reason,
    'exitCode' in result ? result.exitCode : undefined
  );
}

/** 기기가 해당 기능을 지원하지 않음(dadb의 UnsupportedOperationException). 전송 오류가 아니다. */
export class AdbUnsupportedFeatureException extends Error {
  constructor(readonly feature: string, message: string) {
    super(message);
    this.name = 'AdbUnsupportedFeatureException';
  }
}
