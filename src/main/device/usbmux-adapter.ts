import { createRequire } from 'node:module';
import type { UsbmuxClientLike, UsbmuxDeviceRecord, UsbmuxDeviceValues } from './usbmux-client';

// usbmux-client도 CJS interop 이슈를 피하기 위해 createRequire로 로드한다.
const require = createRequire(import.meta.url);

interface RealUsbmuxClient {
  getDevices(): Promise<Record<string, UsbmuxDeviceRecord>>;
  queryAllDeviceValues(deviceId: number): Promise<UsbmuxDeviceValues>;
}

/**
 * 실제 usbmux-client 기반 구현.
 * usbmuxd(맥 기본 데몬)와 통신해 USB로 연결된 iOS 기기를 감지한다.
 * usbmux-client 로드 실패 시(미설치 등) getDevices가 빈 결과를 반환하도록 감싼다.
 */
export function createUsbmuxClient(): UsbmuxClientLike {
  let client: RealUsbmuxClient | undefined;

  const getClient = (): RealUsbmuxClient | undefined => {
    if (client) return client;
    try {
      const mod = require('usbmux-client') as { UsbmuxClient: new () => RealUsbmuxClient };
      client = new mod.UsbmuxClient();
      return client;
    } catch {
      return undefined;
    }
  };

  return {
    async getDevices() {
      const c = getClient();
      if (!c) return {};
      try {
        return await c.getDevices();
      } catch {
        return {};
      }
    },
    async queryAllDeviceValues(deviceId: number) {
      const c = getClient();
      if (!c) return {};
      try {
        return await c.queryAllDeviceValues(deviceId);
      } catch {
        return {};
      }
    }
  };
}
