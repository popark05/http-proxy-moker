/**
 * 프록시에 접속한 기기("접속 기기") 집계.
 *
 * 기기를 연결 수단(adb/usbmux)이 아니라 프록시가 실제로 본 접속 IP로 식별한다. 그래서 USB로 꽂지 않은
 * Wi-Fi 프록시 기기(iOS 수동 설정, Android Wi-Fi)도 보이고, 트래픽 수신 여부와 인증서 신뢰 여부를 알 수 있다.
 * 순수 로직만 둔다(테스트 가능).
 */
import type { CapturedExchange } from './capture';
import type { DeviceInfo } from './device';

export type ClientPlatform = 'ios' | 'android' | 'unknown';

export interface ClientInfo {
  /** 접속 IP(식별자). */
  ip: string;
  platform: ClientPlatform;
  /** User-Agent에서 얻은 모델("iPhone", "SM-N981N"). 알 수 없으면 undefined. */
  model?: string;
  /** OS 버전("17.4", "13"). */
  osVersion?: string;
  requestCount: number;
  /** 복호화되어 캡처된 HTTPS 요청 수(CA를 신뢰한다는 증거). */
  httpsCount: number;
  /** 마지막 요청/TLS 오류 수신 시각(epoch ms). */
  lastSeenAt: number;
  /** CA 불신으로 거부된 TLS 핸드셰이크 수. */
  tlsErrorCount: number;
  /** 거부된 호스트(최대 3개, 최근순). */
  tlsHosts: string[];
  /** 127.0.0.1(Android USB 터널 등 같은 PC를 경유한 접속). */
  local: boolean;
}

/** `::ffff:1.2.3.4` 같은 IPv4-mapped 표기와 `::1`을 사람이 읽는 IPv4로 정규화한다. */
export function normalizeClientIp(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(raw);
  if (mapped) return mapped[1];
  if (raw === '::1') return '127.0.0.1';
  return raw;
}

const LOCAL_IPS = new Set(['127.0.0.1', 'localhost']);

interface UaInfo {
  platform: ClientPlatform;
  model?: string;
  osVersion?: string;
}

/** User-Agent 하나에서 플랫폼/모델/OS 버전을 추정한다(휴리스틱). */
export function parseUserAgent(ua: string | undefined): UaInfo {
  if (!ua) return { platform: 'unknown' };
  const ios = /\b(iPhone|iPad|iPod)\b.*?OS (\d+(?:[_.]\d+)*)/i.exec(ua);
  if (ios) return { platform: 'ios', model: ios[1], osVersion: ios[2].replace(/_/g, '.') };
  // 앱 네트워크 스택 UA(CFNetwork/Darwin)는 OS 버전은 모르지만 iOS/macOS 계열로 본다.
  if (/CFNetwork|Darwin\//.test(ua)) return { platform: 'ios' };
  const android = /Android (\d+(?:\.\d+)*)/i.exec(ua);
  if (android) {
    const model = /Android [\d.]+;\s*([^;)]+?)(?:\s+Build\/|[;)])/i.exec(ua)?.[1]?.trim();
    return { platform: 'android', osVersion: android[1], ...(model && model !== 'K' ? { model } : {}) };
  }
  if (/okhttp|Dalvik/i.test(ua)) return { platform: 'android' };
  return { platform: 'unknown' };
}

function userAgentOf(exchange: CapturedExchange): string | undefined {
  return exchange.request.headers.find(([k]) => k.toLowerCase() === 'user-agent')?.[1];
}

export interface TlsErrorRecord {
  clientIp?: string;
  hostname?: string;
  at: number;
}

/** exchange들과 TLS 거부 기록을 IP별 접속 기기 목록으로 모은다(최근 접속순). */
export function aggregateClients(
  exchanges: readonly CapturedExchange[],
  tlsErrors: readonly TlsErrorRecord[] = []
): ClientInfo[] {
  const map = new Map<string, ClientInfo>();
  // OS 버전/모델까지 아는 UA를 우선하기 위해 더 구체적인 정보로 덮어쓴다.
  const specificity = (u: UaInfo): number => (u.platform === 'unknown' ? 0 : 1) + (u.osVersion ? 1 : 0) + (u.model ? 1 : 0);
  const best = new Map<string, UaInfo>();

  const entry = (ip: string): ClientInfo => {
    let c = map.get(ip);
    if (!c) {
      c = { ip, platform: 'unknown', requestCount: 0, httpsCount: 0, lastSeenAt: 0, tlsErrorCount: 0, tlsHosts: [], local: LOCAL_IPS.has(ip) };
      map.set(ip, c);
    }
    return c;
  };

  for (const e of exchanges) {
    const ip = e.request.clientIp;
    if (!ip) continue;
    const c = entry(ip);
    c.requestCount++;
    if (e.request.url.startsWith('https:')) c.httpsCount++;
    c.lastSeenAt = Math.max(c.lastSeenAt, e.startedAt);
    const ua = parseUserAgent(userAgentOf(e));
    if (specificity(ua) > specificity(best.get(ip) ?? { platform: 'unknown' })) best.set(ip, ua);
  }

  for (const t of tlsErrors) {
    if (!t.clientIp) continue;
    const c = entry(t.clientIp);
    c.tlsErrorCount++;
    c.lastSeenAt = Math.max(c.lastSeenAt, t.at);
    if (t.hostname && !c.tlsHosts.includes(t.hostname)) c.tlsHosts = [t.hostname, ...c.tlsHosts].slice(0, 3);
  }

  for (const [ip, ua] of best) {
    const c = map.get(ip)!;
    c.platform = ua.platform;
    c.model = ua.model;
    c.osVersion = ua.osVersion;
  }
  return [...map.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

/** 접속 IP가 기록되지 않은 요청 수(업데이트 전 워커가 캡처했거나 옛 HAR에서 불러온 것). */
export function countWithoutClientIp(exchanges: readonly CapturedExchange[]): number {
  return exchanges.filter((e) => !e.request.clientIp).length;
}

export type ClientState =
  /** 접속은 하지만 HTTPS가 복호화되지 않음(CA 미신뢰). */
  | 'untrusted'
  /** 최근 트래픽 수신 중. */
  | 'active'
  /** 접속 이력은 있으나 최근 트래픽 없음. */
  | 'idle';

/** 최근 이 시간(ms) 안에 트래픽이 있으면 "수신 중". */
export const ACTIVE_WINDOW_MS = 15_000;

/**
 * 상태 판정. HTTPS가 한 번도 복호화되지 않았는데 TLS 거부가 있으면 CA를 신뢰하지 않은 것(untrusted)이다.
 * 일부 호스트만 거부되는 경우(인증서 고정 앱)는 복호화된 HTTPS가 있으므로 untrusted가 아니다.
 */
export function clientState(client: ClientInfo, now: number): ClientState {
  if (client.tlsErrorCount > 0 && client.httpsCount === 0) return 'untrusted';
  return now - client.lastSeenAt <= ACTIVE_WINDOW_MS ? 'active' : 'idle';
}

/** 사람이 읽는 이름("iPhone · iOS 17.4", "SM-N981N · Android 13", "USB 연결 기기"). */
export function clientLabel(client: ClientInfo, devices: readonly DeviceInfo[] = [], allClients: readonly ClientInfo[] = []): string {
  if (client.local) {
    const androids = devices.filter((d) => d.platform === 'android');
    return androids.length === 1 ? `USB 연결 · ${androids[0].name}` : 'USB 연결 기기(adb)';
  }
  const os = client.platform === 'ios' ? 'iOS' : client.platform === 'android' ? 'Android' : '';
  const detail = [client.model, client.osVersion ? `${os} ${client.osVersion}` : os].filter(Boolean).join(' · ');
  // iOS 기기가 USB로도 한 대만 보이고 Wi-Fi 접속 iOS도 한 대뿐이면 같은 기기로 보고 기기 이름을 쓴다.
  if (client.platform === 'ios') {
    const usb = devices.filter((d) => d.platform === 'ios');
    const wifiIos = allClients.filter((c) => c.platform === 'ios' && !c.local);
    if (usb.length === 1 && wifiIos.length === 1) return detail ? `${usb[0].name} · ${detail}` : usb[0].name;
  }
  return detail || '알 수 없는 기기';
}
