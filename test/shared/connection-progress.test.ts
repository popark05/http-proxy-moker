import { describe, it, expect } from 'vitest';
import { connectionProgress, stepCount, type WizardInput } from '../../src/shared/connection-progress';
import type { ClientInfo } from '../../src/shared/clients';
import type { DeviceInfo, InterceptionResult } from '../../src/shared/device';

const NOW = 1_000_000;
const input = (over: Partial<WizardInput> = {}): WizardInput => ({
  proxyRunning: true,
  proxyAddress: '192.168.0.5:8080',
  devices: [],
  interceptions: {},
  clients: [],
  now: NOW,
  ...over
});
const android = (over: Partial<DeviceInfo> = {}): DeviceInfo => ({ id: 'R3', platform: 'android', name: 'R3', status: 'ready', ...over });
const result = (over: Partial<InterceptionResult> = {}): InterceptionResult => ({
  deviceId: 'R3',
  proxyConfigured: true,
  caInstalled: true,
  warnings: [],
  ...over
});
const client = (over: Partial<ClientInfo> = {}): ClientInfo => ({
  ip: '127.0.0.1',
  platform: 'android',
  requestCount: 5,
  httpsCount: 0,
  lastSeenAt: NOW,
  tlsErrorCount: 0,
  tlsHosts: [],
  lastHttpsAt: 0,
  tlsErrorsOther: 0,
  tlsHostsOther: [],
  lastTlsErrorAt: 0,
  tlsErrorsSinceHttps: 0,
  tlsHostsSinceHttps: [],
  local: true,
  ...over
});
const statuses = (tab: Parameters<typeof connectionProgress>[0], i: WizardInput): string[] =>
  connectionProgress(tab, i).map((s) => s.status);

describe('connectionProgress', () => {
  it('프록시가 꺼져 있으면 첫 단계가 현재, 나머지는 대기', () => {
    const s = statuses('android-usb', input({ proxyRunning: false }));
    expect(s[0]).toBe('current');
    expect(s.slice(1).every((x) => x === 'pending')).toBe(true);
  });

  it('프록시가 꺼지면 과거 증거(접속 기록)가 있어도 처음부터 다시', () => {
    const s = statuses('android-usb', input({ proxyRunning: false, clients: [client()] }));
    expect(s[0]).toBe('current');
  });

  it('Android USB: 기기가 unauthorized면 USB 디버깅 단계가 막힘', () => {
    const steps = connectionProgress('android-usb', input({ devices: [android({ status: 'unauthorized' })] }));
    expect(steps[0].status).toBe('done');
    expect(steps[1].status).toBe('blocked');
    expect(steps[1].reason).toContain('허용');
  });

  it('Android USB: 기기 ready면 다음은 인터셉트 단계가 현재', () => {
    const s = statuses('android-usb', input({ devices: [android()] }));
    expect(s.slice(0, 3)).toEqual(['done', 'done', 'current']);
  });

  it('인터셉션 실패 경고는 인터셉트 단계의 막힘 사유가 된다', () => {
    const steps = connectionProgress(
      'android-usb',
      input({ devices: [android()], interceptions: { R3: result({ proxyConfigured: false, warnings: ['프록시가 실행 중이 아닙니다.'] }) } })
    );
    expect(steps[2].status).toBe('blocked');
    expect(steps[2].reason).toBe('프록시가 실행 중이 아닙니다.');
  });

  it('인터셉션 성공 후 VPN 허용(수동)이 현재', () => {
    const steps = connectionProgress('android-usb', input({ devices: [android()], interceptions: { R3: result() } }));
    expect(steps[2].status).toBe('done');
    expect(steps[3].id).toBe('vpn-allow');
    expect(steps[3].status).toBe('current');
  });

  it('트래픽이 들어오면 수동 단계(VPN 허용)도 끝난 것으로 본다', () => {
    const s = statuses('android-usb', input({ devices: [android()], interceptions: { R3: result() }, clients: [client()] }));
    expect(s).toEqual(['done', 'done', 'done', 'done', 'done', 'current']);
  });

  it('HTTPS 복호화가 확인되면 전부 완료', () => {
    const s = statuses('android-usb', input({ devices: [android()], interceptions: { R3: result() }, clients: [client({ httpsCount: 2 })] }));
    expect(s.every((x) => x === 'done')).toBe(true);
  });

  it('Android USB는 127.0.0.1 접속만, Wi-Fi 탭은 자기 IP 접속만 증거로 센다', () => {
    const wifi = client({ ip: '192.168.0.30', local: false });
    expect(statuses('android-usb', input({ clients: [wifi] })).includes('done')).toBe(true); // 프록시 단계만
    const usbSteps = connectionProgress('android-usb', input({ clients: [wifi] }));
    expect(usbSteps.find((s) => s.id === 'traffic')!.status).not.toBe('done');
    const wifiSteps = connectionProgress('android-wifi-adb', input({ clients: [wifi] }));
    expect(wifiSteps.find((s) => s.id === 'traffic')!.status).toBe('done');
  });

  it('LAN IP가 없으면 Wi-Fi 탭의 같은-Wi-Fi 단계가 막힘', () => {
    const steps = connectionProgress('android-wifi-adb', input({ proxyAddress: '127.0.0.1:8080' }));
    expect(steps.find((s) => s.id === 'lan')!.status).toBe('blocked');
  });

  it('Wi-Fi 수동 탭은 프록시 주소 값을 보여준다', () => {
    const steps = connectionProgress('android-wifi-manual', input());
    expect(steps.find((s) => s.id === 'wifi-proxy')!.value).toBe('192.168.0.5:8080');
  });

  it('iOS: TLS 실패로 미신뢰면 신뢰 설정 단계가 막힘(앞 단계는 완료)', () => {
    const bad = client({
      ip: '192.168.0.20',
      platform: 'ios',
      local: false,
      requestCount: 0,
      tlsErrorsOther: 3,
      tlsHostsOther: ['a.com', 'b.com', 'c.com'],
      lastTlsErrorAt: NOW - 1000,
      tlsErrorsSinceHttps: 3,
      tlsHostsSinceHttps: ['a.com', 'b.com', 'c.com']
    });
    const steps = connectionProgress('ios-wifi', input({ clients: [bad] }));
    const trust = steps.find((s) => s.id === 'trust')!;
    expect(trust.status).toBe('blocked');
    expect(steps.slice(0, steps.indexOf(trust)).every((s) => s.status === 'done')).toBe(true);
  });

  it('iOS: USB 연결 단계는 iOS 기기가 보이면 완료', () => {
    const ios: DeviceInfo = { id: 'u', platform: 'ios', name: 'iPhone', status: 'ready' };
    const steps = connectionProgress('ios-wifi', input({ devices: [ios] }));
    expect(steps.find((s) => s.id === 'usb-detect')!.status).toBe('done');
  });

  it('각 탭의 단계 수는 상태와 무관하게 일정', () => {
    for (const tab of ['android-usb', 'android-wifi-adb', 'android-wifi-manual', 'ios-wifi'] as const) {
      expect(connectionProgress(tab, input())).toHaveLength(stepCount(tab));
    }
  });
});
