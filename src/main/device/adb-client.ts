/**
 * adbkit을 감싸는 최소 인터페이스.
 * AndroidConnector가 이 인터페이스에만 의존하도록 해서 단위 테스트에서 목킹하기 쉽게 한다.
 */

export interface AdbDeviceRecord {
  id: string;
  /** adbkit device type: 'device' | 'emulator' | 'offline' | 'unauthorized' | ... */
  type: string;
}

/** 기기 단위 명령 실행. */
export interface AdbDevice {
  /** shell 명령 실행 후 전체 출력을 문자열로 반환. */
  shell(command: string | string[]): Promise<string>;
  /** 로컬 파일 내용을 기기 경로로 push. */
  pushContent(content: string, remotePath: string): Promise<void>;
  /** adb reverse: 기기의 remote 포트를 호스트 local 포트로 터널. */
  reverse(remote: string, local: string): Promise<void>;
  /** reverse 터널 해제. */
  removeReverse(remote: string): Promise<void>;
  /** 패키지 설치 여부. */
  isInstalled(pkg: string): Promise<boolean>;
  /** 로컬 APK 파일을 설치(-r 재설치). */
  install(apkPath: string): Promise<void>;
  /** 액티비티/인텐트 실행(am start). */
  startActivity(options: { action: string; data?: string; wait?: boolean }): Promise<void>;
  /** 컴포넌트를 포그라운드로(am start -n). */
  bringToFront(component: string): Promise<void>;
}

export interface AdbClient {
  listDevices(): Promise<AdbDeviceRecord[]>;
  getDevice(id: string): AdbDevice;
}
