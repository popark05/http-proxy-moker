import { describe, it, expect } from 'vitest';
import type { CapturedExchange } from '../../src/shared/capture';
import type { DeviceInfo } from '../../src/shared/device';
import {
  ACTIVE_WINDOW_MS,
  aggregateClients,
  clientLabel,
  clientState,
  countWithoutClientIp,
  normalizeClientIp,
  parseUserAgent,
  UNTRUSTED_WINDOW_MS
} from '../../src/shared/clients';

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 13; SM-N981N Build/TP1A.220624.014) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';

function ex(id: string, ip: string | undefined, url: string, ua?: string, at = 1000): CapturedExchange {
  return {
    id,
    startedAt: at,
    request: {
      method: 'GET',
      url,
      path: '/',
      headers: ua ? [['User-Agent', ua]] : [],
      body: { encoding: 'empty', content: '', byteLength: 0 },
      clientIp: ip
    }
  };
}

describe('parseUserAgent', () => {
  it('iOS Safari/WebView UA에서 모델과 OS 버전을 뽑는다', () => {
    expect(parseUserAgent(IOS_UA)).toEqual({ platform: 'ios', model: 'iPhone', osVersion: '17.4' });
  });
  it('앱의 CFNetwork/Darwin UA는 iOS로만 판단한다', () => {
    expect(parseUserAgent('MyApp/3.1 CFNetwork/1494.0.7 Darwin/23.4.0')).toEqual({ platform: 'ios' });
  });
  it('Android WebView UA에서 모델과 버전을 뽑고, okhttp/Dalvik은 Android로 본다', () => {
    expect(parseUserAgent(ANDROID_UA)).toEqual({ platform: 'android', osVersion: '13', model: 'SM-N981N' });
    expect(parseUserAgent('okhttp/4.12.0').platform).toBe('android');
    expect(parseUserAgent('Dalvik/2.1.0 (Linux; U; Android 12; Pixel 6 Build/SD1A)')).toMatchObject({ platform: 'android', model: 'Pixel 6' });
  });
  it('알 수 없는 UA/없음은 unknown', () => {
    expect(parseUserAgent('curl/8.4.0').platform).toBe('unknown');
    expect(parseUserAgent(undefined).platform).toBe('unknown');
  });
});

describe('normalizeClientIp', () => {
  it('IPv4-mapped와 ::1을 읽기 쉬운 IPv4로', () => {
    expect(normalizeClientIp('::ffff:192.168.45.12')).toBe('192.168.45.12');
    expect(normalizeClientIp('::1')).toBe('127.0.0.1');
    expect(normalizeClientIp('10.0.0.5')).toBe('10.0.0.5');
    expect(normalizeClientIp(undefined)).toBeUndefined();
  });
});

describe('aggregateClients', () => {
  it('IP별로 요청 수/HTTPS 수/최근 시각을 모으고 최근 접속순으로 정렬한다', () => {
    const list = aggregateClients([
      ex('1', '192.168.0.10', 'https://a.com/x', IOS_UA, 1000),
      ex('2', '192.168.0.10', 'http://a.com/y', IOS_UA, 3000),
      ex('3', '127.0.0.1', 'https://b.com/z', ANDROID_UA, 2000),
      ex('4', undefined, 'https://c.com/', IOS_UA, 9000) // 접속 IP 없음(옛 HAR 등)은 제외
    ]);
    expect(list.map((c) => c.ip)).toEqual(['192.168.0.10', '127.0.0.1']);
    expect(list[0]).toMatchObject({ platform: 'ios', model: 'iPhone', osVersion: '17.4', requestCount: 2, httpsCount: 1, lastSeenAt: 3000, local: false });
    expect(list[1]).toMatchObject({ platform: 'android', local: true });
  });

  it('여러 UA 중 더 구체적인 것을 기기 정보로 쓴다', () => {
    const list = aggregateClients([
      ex('1', '10.0.0.2', 'https://a.com', 'MyApp CFNetwork/1 Darwin/23', 1),
      ex('2', '10.0.0.2', 'https://a.com', IOS_UA, 2)
    ]);
    expect(list[0]).toMatchObject({ platform: 'ios', osVersion: '17.4' });
  });

  it('TLS 거부만 있는 기기도 목록에 나타난다(요청이 한 건도 복호화되지 않은 iPhone)', () => {
    const list = aggregateClients([], [
      { clientIp: '192.168.0.20', hostname: 'api.a.com', at: 5000 },
      { clientIp: '192.168.0.20', hostname: 'api.a.com', at: 6000 },
      { clientIp: '192.168.0.20', hostname: 'cdn.b.com', at: 7000 }
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ ip: '192.168.0.20', tlsErrorCount: 3, requestCount: 0, lastSeenAt: 7000 });
    expect(list[0].tlsHosts).toEqual(['cdn.b.com', 'api.a.com']);
  });
});

describe('clientState', () => {
  const base = { ip: '1', platform: 'ios' as const, requestCount: 5, httpsCount: 3, lastSeenAt: 10_000, tlsErrorCount: 0, tlsHosts: [], lastHttpsAt: 10_000, lastTlsErrorAt: 0, tlsErrorsSinceHttps: 0, tlsHostsSinceHttps: [], local: false };
  it('복호화된 HTTPS 없이 TLS 거부가 있으면 untrusted', () => {
    expect(clientState({ ...base, httpsCount: 0, tlsErrorCount: 2 }, 10_500)).toBe('untrusted');
  });
  it('일부 호스트만 거부(복호화된 HTTPS 있음)는 untrusted가 아니다(인증서 고정 앱)', () => {
    expect(clientState({ ...base, tlsErrorCount: 2 }, 10_500)).toBe('active');
  });
  it('최근 트래픽이면 active, 오래되면 idle', () => {
    expect(clientState(base, 10_000 + ACTIVE_WINDOW_MS)).toBe('active');
    expect(clientState(base, 10_000 + ACTIVE_WINDOW_MS + 1)).toBe('idle');
  });
});

describe('신뢰 설정을 중간에 끈 경우(과거에 복호화 성공 기록이 있는 기기)', () => {
  const T0 = 1_000_000;
  const https = (id: string, at: number) => ex(id, '192.168.0.20', 'https://api.a.com/x', IOS_UA, at);
  const fail = (host: string, at: number) => ({ clientIp: '192.168.0.20', hostname: host, at });

  it('성공 이후 여러 호스트에서 실패하면 미신뢰로 본다(과거 성공 기록과 무관)', () => {
    const [c] = aggregateClients(
      [https('1', T0), https('2', T0 + 1000)],
      [fail('a.com', T0 + 5000), fail('b.com', T0 + 5100)]
    );
    expect(c.httpsCount).toBe(2);
    expect(c.lastHttpsAt).toBe(T0 + 1000);
    expect(c.tlsErrorsSinceHttps).toBe(2);
    expect(c.tlsHostsSinceHttps).toEqual(['b.com', 'a.com']);
    expect(clientState(c, T0 + 6000)).toBe('untrusted');
  });

  it('같은 호스트가 3번 이상 계속 실패해도 미신뢰', () => {
    const [c] = aggregateClients([https('1', T0)], [fail('a.com', T0 + 1000), fail('a.com', T0 + 2000), fail('a.com', T0 + 3000)]);
    expect(clientState(c, T0 + 4000)).toBe('untrusted');
  });

  it('인증서를 고정한 앱 하나의 1~2회 실패는 미신뢰가 아니다', () => {
    const [c] = aggregateClients([https('1', T0)], [fail('pinned.apple.com', T0 + 1000), fail('pinned.apple.com', T0 + 2000)]);
    expect(clientState(c, T0 + 3000)).toBe('active');
  });

  it('실패 뒤에 복호화가 다시 성공하면(신뢰를 다시 켬) 미신뢰가 풀린다', () => {
    const [c] = aggregateClients(
      [https('1', T0), https('2', T0 + 10_000)],
      [fail('a.com', T0 + 1000), fail('b.com', T0 + 2000), fail('c.com', T0 + 3000)]
    );
    expect(c.tlsErrorsSinceHttps).toBe(0);
    expect(clientState(c, T0 + 11_000)).toBe('active');
  });

  it('실패가 60초 넘게 없으면 미신뢰를 유지하지 않는다', () => {
    const [c] = aggregateClients([https('1', T0)], [fail('a.com', T0 + 1000), fail('b.com', T0 + 2000)]);
    expect(clientState(c, T0 + 2000 + UNTRUSTED_WINDOW_MS)).toBe('untrusted');
    expect(clientState(c, T0 + 2000 + UNTRUSTED_WINDOW_MS + 1)).not.toBe('untrusted');
  });
});

describe('clientLabel', () => {
  const ios = { ip: '192.168.0.10', platform: 'ios' as const, model: 'iPhone', osVersion: '17.4', requestCount: 1, httpsCount: 1, lastSeenAt: 1, tlsErrorCount: 0, tlsHosts: [], lastHttpsAt: 1, lastTlsErrorAt: 0, tlsErrorsSinceHttps: 0, tlsHostsSinceHttps: [], local: false };
  const dev = (platform: 'ios' | 'android', name: string): DeviceInfo => ({ id: name, platform, name, status: 'ready' });

  it('모델과 OS 버전으로 이름을 만든다', () => {
    expect(clientLabel(ios)).toBe('iPhone · iOS 17.4');
    expect(clientLabel({ ...ios, platform: 'unknown', model: undefined, osVersion: undefined })).toBe('알 수 없는 기기');
  });
  it('127.0.0.1 접속은 USB 연결로 표시하고, Android USB 기기가 한 대면 그 이름을 붙인다', () => {
    const local = { ...ios, ip: '127.0.0.1', local: true, platform: 'android' as const };
    expect(clientLabel(local, [dev('android', 'R3CR10LXLZW')])).toBe('USB 연결 · R3CR10LXLZW');
    expect(clientLabel(local, [dev('android', 'A'), dev('android', 'B')])).toBe('USB 연결 기기(adb)');
  });
  it('USB iOS 한 대 + Wi-Fi iOS 한 대면 같은 기기로 보고 기기 이름을 쓴다', () => {
    expect(clientLabel(ios, [dev('ios', '민수의 iPhone')], [ios])).toBe('민수의 iPhone · iPhone · iOS 17.4');
    expect(clientLabel(ios, [dev('ios', 'A'), dev('ios', 'B')], [ios])).toBe('iPhone · iOS 17.4');
  });
});

describe('countWithoutClientIp', () => {
  it('접속 IP가 없는 요청만 센다', () => {
    expect(countWithoutClientIp([ex('1', undefined, 'https://a.com'), ex('2', '1.1.1.1', 'https://a.com'), ex('3', undefined, 'https://b.com')])).toBe(2);
  });
});
