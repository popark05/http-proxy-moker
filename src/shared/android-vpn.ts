/**
 * Android non-root VPN(companion APK) 관련 상수/타입.
 * HTTPToolkit companion 앱(tech.httptoolkit.android.v1)을 재사용한다.
 */

/** companion 앱 패키지명. */
export const COMPANION_PACKAGE = 'tech.httptoolkit.android.v1';
/**
 * companion 앱 메인 액티비티(bringToFront용).
 * 실기기 검증 결과 실제 경로는 `.main.MainActivity`(패키지 하위 main 서브패키지).
 */
export const COMPANION_MAIN_ACTIVITY = `${COMPANION_PACKAGE}/tech.httptoolkit.android.main.MainActivity`;

/** 활성/비활성 인텐트 액션. */
export const ACTIVATE_ACTION = 'tech.httptoolkit.android.ACTIVATE';
export const DEACTIVATE_ACTION = 'tech.httptoolkit.android.DEACTIVATE';

/** 에뮬레이터 호스트 IP(호스트 loopback). */
export const EMULATOR_HOST_IPS = [
  '10.0.2.2', // 표준 Android 에뮬레이터
  '10.0.3.2' // Genymotion
];

/**
 * companion 앱에 전달하는 프록시 셋업 파라미터.
 * 앱이 addresses를 순회하며 프록시 연결을 테스트하고,
 * amiusing.httptoolkit.tech/certificate 응답의 SPKI 지문이 certFingerprint와 일치하면 신뢰한다.
 */
export interface CompanionSetupParams {
  /** 프록시에 도달 가능한 주소 후보(에뮬레이터 IP + 호스트 LAN IP). */
  addresses: string[];
  /** 프록시 포트. */
  port: number;
  /** adb reverse 터널 포트(있으면 127.0.0.1 폴백에 사용). */
  localTunnelPort?: number;
  /** SOCKS 사용 여부(기본 false). */
  enableSocks: boolean;
  /** 우리 CA의 SPKI SHA-256 지문(base64). CaManager.getInfo().spkiSha256. */
  certFingerprint: string;
}

/** companion 앱 connect URL의 베이스. */
export const CONNECT_URL_BASE = 'https://android.httptoolkit.tech/connect/';
