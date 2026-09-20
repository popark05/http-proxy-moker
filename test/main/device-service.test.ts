// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { DeviceService } from '../../src/main/device/device-service';
import type { DeviceConnector, InterceptionOptions } from '../../src/main/device/device-connector';
import type { DeviceInfo, InterceptionResult } from '../../src/shared/device';

function fakeConnector(
  platform: 'android' | 'ios',
  devices: DeviceInfo[]
): DeviceConnector & { lastOptions?: InterceptionOptions } {
  const connector = {
    platform,
    lastOptions: undefined as InterceptionOptions | undefined,
    async listDevices() {
      return devices;
    },
    async startInterception(deviceId: string, options: InterceptionOptions) {
      connector.lastOptions = options;
      return {
        deviceId,
        proxyConfigured: true,
        caInstalled: platform === 'android',
        warnings: []
      } satisfies InterceptionResult;
    },
    async stopInterception() {},
    getSetupInstructions() {
      return platform === 'ios' ? [{ title: 'step', detail: 'do it' }] : [];
    }
  };
  return connector;
}

const options: InterceptionOptions = { proxyHost: '10.0.0.1', proxyPort: 8080, caPem: 'ca' };

describe('DeviceService', () => {
  it('여러 커넥터의 기기를 합쳐 반환', async () => {
    const service = new DeviceService(async () => options);
    service.register(
      fakeConnector('android', [
        { id: 'a', platform: 'android', name: 'A', status: 'ready' }
      ])
    );
    service.register(
      fakeConnector('ios', [{ id: 'i', platform: 'ios', name: 'iPhone', status: 'ready' }])
    );

    const devices = await service.listDevices();
    expect(devices.map((d) => d.id).sort()).toEqual(['a', 'i']);
  });

  it('startInterception은 provider 옵션을 커넥터에 전달', async () => {
    const android = fakeConnector('android', [
      { id: 'a', platform: 'android', name: 'A', status: 'ready' }
    ]);
    const service = new DeviceService(async () => options);
    service.register(android);

    const result = await service.startInterception('android', 'a');
    expect(result.proxyConfigured).toBe(true);
    expect(android.lastOptions).toEqual(options);
  });

  it('플랫폼별로 올바른 커넥터로 라우팅', async () => {
    const android = fakeConnector('android', []);
    const ios = fakeConnector('ios', []);
    const service = new DeviceService(async () => options);
    service.register(android);
    service.register(ios);

    // ios 시작 시 android 커넥터는 호출되지 않아야 함.
    const result = await service.startInterception('ios', 'udid');
    expect(result.caInstalled).toBe(false); // ios fakeConnector는 caInstalled=false
    expect(ios.lastOptions).toEqual(options);
    expect(android.lastOptions).toBeUndefined();
  });

  it('getSetupInstructions는 플랫폼별 커넥터에 위임', async () => {
    const service = new DeviceService(async () => options);
    service.register(fakeConnector('ios', []));
    const steps = await service.getSetupInstructions('ios');
    expect(steps).toHaveLength(1);
  });

  it('등록 안 된 플랫폼의 setup은 빈 배열', async () => {
    const service = new DeviceService(async () => options);
    expect(await service.getSetupInstructions('ios')).toEqual([]);
  });
});
