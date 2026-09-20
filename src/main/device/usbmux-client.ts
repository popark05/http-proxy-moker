/**
 * usbmux-client를 감싸는 최소 인터페이스.
 * IosConnector가 이 인터페이스에만 의존하도록 해 단위 테스트에서 목킹하기 쉽게 한다.
 */

export interface UsbmuxDeviceValues {
  DeviceName?: string;
  DeviceClass?: string;
  UniqueDeviceID?: string;
  ProductVersion?: string;
  [key: string]: string | undefined;
}

export interface UsbmuxDeviceRecord {
  DeviceID: number;
}

export interface UsbmuxClientLike {
  /** 연결된 기기 목록(키는 인덱스, 값은 DeviceID 포함 레코드). */
  getDevices(): Promise<Record<string, UsbmuxDeviceRecord>>;
  /** 특정 기기의 모든 값(이름/클래스/UDID 등). */
  queryAllDeviceValues(deviceId: number): Promise<UsbmuxDeviceValues>;
}
