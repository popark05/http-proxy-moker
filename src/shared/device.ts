/**
 * 기기 연동 관련 공유 타입.
 * Android(자동) / iOS(반자동)를 플랫폼 추상화로 다룬다.
 */

export type DevicePlatform = 'android' | 'ios';

/**
 * Android 인터셉션 방식.
 * - auto: root 가능하면 시스템 CA 주입, 아니면 VPN 컴패니언.
 * - root: 시스템 CA 주입(root 필요, 모든 앱 HTTPS 복호화).
 * - vpn: companion VPN 앱(non-root 실기기).
 */
export type AndroidInterceptionMode = 'auto' | 'root' | 'vpn';

export interface DeviceInfo {
  /** 플랫폼별 고유 식별자(android: adb serial, ios: udid). */
  id: string;
  platform: DevicePlatform;
  name: string;
  /** 연결/사용 가능 상태. */
  status: 'ready' | 'unauthorized' | 'offline' | 'unknown';
}

/** 인터셉션 셋업 결과. */
export interface InterceptionResult {
  deviceId: string;
  /** 프록시 설정이 적용됐는가. */
  proxyConfigured: boolean;
  /** 시스템 CA가 주입됐는가(HTTPS 복호화 가능 여부). */
  caInstalled: boolean;
  /** 사용자에게 보여줄 경고/안내(예: root 불가). */
  warnings: string[];
  /** 실제로 사용된 인터셉션 방식(android). */
  usedMode?: 'root' | 'vpn';
}

/**
 * 수동 셋업 단계(iOS 등 자동화 불가한 플랫폼용).
 * 각 단계는 사용자가 기기에서 직접 수행한다.
 */
export interface SetupStep {
  title: string;
  detail: string;
  /** 이 단계와 관련된 값(예: 프록시 주소). */
  value?: string;
}
