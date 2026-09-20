// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { AndroidConnector } from '../../src/main/device/android/android-connector';
import type { AdbClient, AdbDevice, AdbDeviceRecord } from '../../src/main/device/adb-client';

const SAMPLE_CERT = `-----BEGIN CERTIFICATE-----\n${Buffer.from('c').toString(
  'base64'
)}\n-----END CERTIFICATE-----`;

function makeAdbClient(
  devices: AdbDeviceRecord[],
  shellImpl: (cmd: string) => string,
  overrides: Partial<AdbDevice> = {}
): { client: AdbClient; device: AdbDevice } {
  const device: AdbDevice = {
    shell: vi.fn(async (command) => {
      const cmd = Array.isArray(command) ? command.join(' ') : command;
      return shellImpl(cmd);
    }),
    pushContent: vi.fn(async () => {}),
    reverse: vi.fn(async () => {}),
    removeReverse: vi.fn(async () => {}),
    isInstalled: vi.fn(async () => true),
    install: vi.fn(async () => {}),
    startActivity: vi.fn(async () => {}),
    bringToFront: vi.fn(async () => {}),
    ...overrides
  };
  const client: AdbClient = {
    listDevices: vi.fn(async () => devices),
    getDevice: vi.fn(() => device)
  };
  return { client, device };
}

describe('AndroidConnector.listDevices', () => {
  it('adbkit type을 status로 매핑', async () => {
    const { client } = makeAdbClient(
      [
        { id: 'emulator-5554', type: 'device' },
        { id: 'phone1', type: 'unauthorized' },
        { id: 'phone2', type: 'offline' }
      ],
      () => ''
    );
    const connector = new AndroidConnector(client);
    const devices = await connector.listDevices();

    expect(devices).toHaveLength(3);
    expect(devices[0].status).toBe('ready');
    expect(devices[1].status).toBe('unauthorized');
    expect(devices[2].status).toBe('offline');
    expect(devices[0].platform).toBe('android');
  });

  it('listDevices 실패 시 빈 배열(ADB 미설치 등)', async () => {
    const client: AdbClient = {
      listDevices: vi.fn(async () => {
        throw new Error('ENOENT');
      }),
      getDevice: vi.fn()
    };
    expect(await new AndroidConnector(client).listDevices()).toEqual([]);
  });
});

describe('AndroidConnector.startInterception (root)', () => {
  it('root 기기: 프록시 설정 + CA 주입 성공', async () => {
    const { client, device } = makeAdbClient([{ id: 'emu', type: 'emulator' }], (cmd) =>
      cmd === 'id' ? 'uid=0(root)' : ''
    );
    const connector = new AndroidConnector(client);

    const result = await connector.startInterception('emu', {
      proxyHost: '10.0.2.2',
      proxyPort: 8080,
      caPem: SAMPLE_CERT,
      androidMode: 'root'
    });

    expect(result.proxyConfigured).toBe(true);
    expect(result.caInstalled).toBe(true);
    expect(result.usedMode).toBe('root');
    expect(result.warnings).toHaveLength(0);
    expect(device.reverse).toHaveBeenCalledWith('tcp:8080', 'tcp:8080');
  });

  it('root 강제인데 non-root면: 프록시만, CA 실패 경고', async () => {
    const { client } = makeAdbClient([{ id: 'phone', type: 'device' }], (cmd) =>
      cmd === 'id' ? 'uid=2000(shell)' : ''
    );
    const connector = new AndroidConnector(client);

    const result = await connector.startInterception('phone', {
      proxyHost: '192.168.0.5',
      proxyPort: 8080,
      caPem: SAMPLE_CERT,
      androidMode: 'root'
    });

    expect(result.proxyConfigured).toBe(true);
    expect(result.caInstalled).toBe(false);
    expect(result.usedMode).toBe('root');
    expect(result.warnings.some((w) => w.includes('root'))).toBe(true);
  });
});

describe('AndroidConnector.startInterception (vpn)', () => {
  it('vpn 모드: 미설치면 APK 설치 후 ACTIVATE 인텐트', async () => {
    const { client, device } = makeAdbClient([{ id: 'phone', type: 'device' }], () => '', {
      isInstalled: vi.fn(async () => false)
    });
    const apkManager = { ensureApk: vi.fn(async () => '/tmp/app.apk'), clearCache: vi.fn() };
    const connector = new AndroidConnector(client, apkManager as never);

    const result = await connector.startInterception('phone', {
      proxyHost: '192.168.0.5',
      proxyPort: 8080,
      certFingerprint: 'FP',
      androidMode: 'vpn'
    });

    expect(result.usedMode).toBe('vpn');
    expect(apkManager.ensureApk).toHaveBeenCalled();
    expect(device.install).toHaveBeenCalledWith('/tmp/app.apk');
    expect(device.bringToFront).toHaveBeenCalled();

    // ACTIVATE 인텐트가 connect URL과 함께 실행됐는지.
    const startCalls = (device.startActivity as ReturnType<typeof vi.fn>).mock.calls;
    const activate = startCalls.find((c) => c[0].action?.includes('ACTIVATE'));
    expect(activate).toBeDefined();
    expect(activate![0].data).toContain('android.httptoolkit.tech/connect');
  });

  it('vpn 모드: 이미 설치돼 있으면 재설치하지 않는다', async () => {
    const { client, device } = makeAdbClient([{ id: 'phone', type: 'device' }], () => '', {
      isInstalled: vi.fn(async () => true)
    });
    const apkManager = { ensureApk: vi.fn(), clearCache: vi.fn() };
    const connector = new AndroidConnector(client, apkManager as never);

    await connector.startInterception('phone', {
      proxyHost: '192.168.0.5',
      proxyPort: 8080,
      certFingerprint: 'FP',
      androidMode: 'vpn'
    });

    expect(device.install).not.toHaveBeenCalled();
  });

  it('vpn 모드: 프록시 미실행이면 인텐트를 보내지 않고 경고', async () => {
    const { client, device } = makeAdbClient([{ id: 'phone', type: 'device' }], () => '', {
      isInstalled: vi.fn(async () => true)
    });
    const apkManager = { ensureApk: vi.fn(), clearCache: vi.fn() };
    const connector = new AndroidConnector(client, apkManager as never);

    const result = await connector.startInterception('phone', {
      proxyHost: '192.168.0.5',
      proxyPort: 8080,
      certFingerprint: 'FP',
      proxyRunning: false,
      androidMode: 'vpn'
    });

    expect(result.usedMode).toBe('vpn');
    expect(result.proxyConfigured).toBe(false);
    expect(result.caInstalled).toBe(false);
    expect(result.warnings.some((w) => w.includes('프록시'))).toBe(true);
    // 신뢰 검증이 불가능하므로 ACTIVATE 인텐트를 보내지 않는다.
    expect(device.startActivity).not.toHaveBeenCalled();
  });

  it('auto 모드 + non-root면 vpn으로 폴백', async () => {
    const { client, device } = makeAdbClient([{ id: 'phone', type: 'device' }], (cmd) =>
      cmd === 'id' ? 'uid=2000(shell)' : ''
    );
    const apkManager = { ensureApk: vi.fn(async () => '/tmp/app.apk'), clearCache: vi.fn() };
    const connector = new AndroidConnector(client, apkManager as never);

    const result = await connector.startInterception('phone', {
      proxyHost: '192.168.0.5',
      proxyPort: 8080,
      caPem: SAMPLE_CERT,
      certFingerprint: 'FP',
      androidMode: 'auto'
    });

    expect(result.usedMode).toBe('vpn');
    expect(device.startActivity).toHaveBeenCalled();
  });
});

describe('AndroidConnector.stopInterception', () => {
  it('프록시를 해제한다', async () => {
    const { client, device } = makeAdbClient([{ id: 'emu', type: 'emulator' }], () => '');
    await new AndroidConnector(client).stopInterception('emu');
    const shellCalls = (device.shell as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join('\n');
    expect(shellCalls).toContain('http_proxy');
  });
});
