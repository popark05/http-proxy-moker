// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  isRootOutput,
  certFileName,
  detectRootCommand,
  setProxy,
  clearProxy,
  injectSystemCertificate
} from '../../src/main/device/android/adb-ops';
import type { AdbDevice } from '../../src/main/device/adb-client';

const SAMPLE_CERT = `-----BEGIN CERTIFICATE-----\n${Buffer.from('cert-bytes').toString(
  'base64'
)}\n-----END CERTIFICATE-----`;

/** 스크립트된 shell 출력을 반환하는 목 AdbDevice. */
function mockDevice(shellImpl: (cmd: string) => string): {
  device: AdbDevice;
  commands: string[];
} {
  const commands: string[] = [];
  const device: AdbDevice = {
    async shell(command) {
      const cmd = Array.isArray(command) ? command.join(' ') : command;
      commands.push(cmd);
      return shellImpl(cmd);
    },
    pushContent: vi.fn(async () => {}),
    reverse: vi.fn(async () => {}),
    removeReverse: vi.fn(async () => {})
  };
  return { device, commands };
}

describe('isRootOutput', () => {
  it('uid=0(root)을 포함하면 root', () => {
    expect(isRootOutput('uid=0(root) gid=0(root)')).toBe(true);
    expect(isRootOutput('uid=2000(shell)')).toBe(false);
  });
});

describe('certFileName', () => {
  it('.0 확장자의 안정적 파일명을 만든다', () => {
    const name = certFileName(SAMPLE_CERT);
    expect(name).toMatch(/^[0-9a-f]{8}\.0$/);
    // 동일 인증서는 동일 파일명(결정적).
    expect(certFileName(SAMPLE_CERT)).toBe(name);
  });
});

describe('detectRootCommand', () => {
  it('이미 root면 항등 래퍼를 반환', async () => {
    const { device } = mockDevice((cmd) => (cmd === 'id' ? 'uid=0(root)' : ''));
    const root = await detectRootCommand(device);
    expect(root).toBeDefined();
    expect(root!('mount')).toBe('mount');
  });

  it('su -c가 필요한 경우 해당 래퍼를 반환', async () => {
    const { device } = mockDevice((cmd) => {
      if (cmd === 'id') return 'uid=2000(shell)';
      if (cmd === "su -c 'id'") return 'uid=0(root)';
      return '';
    });
    const root = await detectRootCommand(device);
    expect(root).toBeDefined();
    expect(root!('mount')).toBe("su -c 'mount'");
  });

  it('root 불가면 undefined', async () => {
    const { device } = mockDevice(() => 'uid=2000(shell)');
    expect(await detectRootCommand(device)).toBeUndefined();
  });
});

describe('setProxy / clearProxy', () => {
  it('setProxy는 http_proxy를 host:port로 설정', async () => {
    const { device, commands } = mockDevice(() => '');
    await setProxy(device, '192.168.0.5', 8080);
    expect(commands).toContain('settings put global http_proxy 192.168.0.5:8080');
  });

  it('clearProxy는 프록시를 해제', async () => {
    const { device, commands } = mockDevice(() => '');
    await clearProxy(device);
    expect(commands.some((c) => c.includes('http_proxy :0'))).toBe(true);
    expect(commands.some((c) => c.includes('delete global http_proxy'))).toBe(true);
  });
});

describe('injectSystemCertificate', () => {
  it('push → remount rw → cp → chmod → remount ro 순서로 실행', async () => {
    const { device, commands } = mockDevice(() => '');
    const pushSpy = device.pushContent as ReturnType<typeof vi.fn>;
    const root = (cmd: string): string => cmd; // 이미 root

    await injectSystemCertificate(device, root, SAMPLE_CERT);

    expect(pushSpy).toHaveBeenCalledOnce();
    const joined = commands.join('\n');
    expect(joined).toContain('mount -o rw,remount /system');
    expect(joined).toContain('/system/etc/security/cacerts/');
    expect(joined).toContain('chmod 644');
    expect(joined).toContain('mount -o ro,remount /system');
  });
});
