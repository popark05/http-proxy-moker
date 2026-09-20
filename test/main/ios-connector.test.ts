// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { IosConnector } from '../../src/main/device/ios/ios-connector';
import type { UsbmuxClientLike } from '../../src/main/device/usbmux-client';

const options = { proxyHost: '192.168.0.10', proxyPort: 8080, caPem: 'ca' };

describe('IosConnector.listDevices', () => {
  it('usbmux 기기를 UDID/이름으로 매핑', async () => {
    const usbmux: UsbmuxClientLike = {
      getDevices: vi.fn(async () => ({
        '0': { DeviceID: 1 },
        '1': { DeviceID: 2 }
      })),
      queryAllDeviceValues: vi.fn(async (id: number) =>
        id === 1
          ? { DeviceName: 'QA iPhone', UniqueDeviceID: 'udid-1' }
          : { DeviceClass: 'iPad', UniqueDeviceID: 'udid-2' }
      )
    };
    const devices = await new IosConnector(usbmux).listDevices();

    expect(devices).toHaveLength(2);
    expect(devices[0]).toMatchObject({ id: 'udid-1', name: 'QA iPhone', platform: 'ios' });
    expect(devices[1]).toMatchObject({ id: 'udid-2', name: 'iPad' });
  });

  it('usbmux 실패 시 빈 배열(미연결/미설치)', async () => {
    const usbmux: UsbmuxClientLike = {
      getDevices: vi.fn(async () => {
        throw new Error('no usbmuxd');
      }),
      queryAllDeviceValues: vi.fn()
    };
    expect(await new IosConnector(usbmux).listDevices()).toEqual([]);
  });
});

describe('IosConnector.startInterception', () => {
  it('자동 설정하지 않고 수동 셋업 경고를 반환', async () => {
    const usbmux: UsbmuxClientLike = {
      getDevices: vi.fn(),
      queryAllDeviceValues: vi.fn()
    };
    const result = await new IosConnector(usbmux).startInterception('udid', options);
    expect(result.proxyConfigured).toBe(false);
    expect(result.caInstalled).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('IosConnector.getSetupInstructions', () => {
  it('프록시 주소를 포함한 4단계 가이드를 제공', () => {
    const usbmux: UsbmuxClientLike = {
      getDevices: vi.fn(),
      queryAllDeviceValues: vi.fn()
    };
    const steps = new IosConnector(usbmux).getSetupInstructions(options);
    expect(steps.length).toBe(4);
    const proxyStep = steps.find((s) => s.value === '192.168.0.10:8080');
    expect(proxyStep).toBeDefined();
    // 인증서 신뢰 활성화 단계가 포함돼야 함(iOS 핵심).
    expect(steps.some((s) => s.detail.includes('인증서 신뢰'))).toBe(true);
  });
});
