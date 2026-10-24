import type {
  AndroidInterceptionMode,
  AndroidTrafficPath,
  DeviceInfo,
  DevicePlatform,
  InterceptionResult,
  SetupStep
} from '@shared/device';
import type { ProgressReporter } from '@shared/progress';
import type { InterceptionLiveness } from '@shared/interception-liveness';

export interface InterceptionOptions {
  proxyHost: string;
  proxyPort: number;
  /** HTTPS 복호화용 CA PEM(있으면 기기에 설치 시도). */
  caPem?: string;
  /** CA의 SPKI SHA-256 지문(base64). VPN 컴패니언 활성화에 사용. */
  certFingerprint?: string;
  /** 프록시가 실제로 실행 중인가. VPN 컴패니언은 프록시 엔드포인트로 신뢰를 검증하므로 필수. */
  proxyRunning?: boolean;
  /** Android 인터셉션 방식. 기본 'auto'. */
  androidMode?: AndroidInterceptionMode;
  /** Android 트래픽 경로. 기본 'usb'. */
  trafficPath?: AndroidTrafficPath;
  /** 진행 단계 보고(로딩 토스트용, 선택). */
  report?: ProgressReporter;
}

/**
 * 플랫폼별 기기 연동을 추상화한다.
 * - Android: 완전 자동(프록시 설정 + CA 주입 + reverse).
 * - iOS: 반자동(감지 + 수동 셋업 가이드).
 */
export interface DeviceConnector {
  readonly platform: DevicePlatform;

  /** 연결된 기기 목록. 도구/기기 없음은 빈 배열로(에러 던지지 않음). */
  listDevices(): Promise<DeviceInfo[]>;

  /** 인터셉션 시작. 자동화 불가한 부분은 result.warnings로 알린다. */
  startInterception(deviceId: string, options: InterceptionOptions): Promise<InterceptionResult>;

  /** 인터셉션 해제. */
  stopInterception(deviceId: string, report?: ProgressReporter): Promise<void>;

  /**
   * 시작한 인터셉션이 기기에서 지금도 살아 있는지 확인(선택). 사용자가 기기에서 직접 연결을 해제한 경우를 알아채는 데 쓴다.
   * 확인 자체가 실패하면 'unknown'. 구현하지 않는 플랫폼(iOS)은 항상 unknown으로 취급한다.
   */
  checkInterception?(deviceId: string, usedMode: 'root' | 'vpn'): Promise<InterceptionLiveness>;

  /** 수동 셋업 안내 단계(iOS 등). 자동 플랫폼은 빈 배열. */
  getSetupInstructions(options: InterceptionOptions): SetupStep[];
}
