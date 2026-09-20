import type {
  AndroidInterceptionMode,
  DeviceInfo,
  DevicePlatform,
  InterceptionResult,
  SetupStep
} from '@shared/device';

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
  stopInterception(deviceId: string): Promise<void>;

  /** 수동 셋업 안내 단계(iOS 등). 자동 플랫폼은 빈 배열. */
  getSetupInstructions(options: InterceptionOptions): SetupStep[];
}
