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
  /** CA 불신 등으로 실패한 TLS 핸드셰이크 수(누적). */
  tlsErrorCount: number;
  /** 실패한 호스트(최대 3개, 최근순). */
  tlsHosts: string[];
  /** 마지막으로 복호화된 HTTPS 요청 시각(없으면 0). */
  lastHttpsAt: number;
  /** "고정 시스템 호스트(iCloud 등)를 뺀" TLS 실패 수 — CA 미신뢰를 판단하는 근거. */
  tlsErrorsOther: number;
  /** 고정 호스트를 뺀 실패 호스트(최대 3개, 최근순). */
  tlsHostsOther: string[];
  /** 마지막 근거 실패 시각(고정 호스트 제외, 없으면 0). */
  lastTlsErrorAt: number;
  /** 마지막 복호화 성공 "이후"의 근거 실패 수. 신뢰를 끈 순간부터의 상황을 본다. */
  tlsErrorsSinceHttps: number;
  /** 마지막 복호화 성공 이후 실패한 서로 다른 호스트(고정 호스트 제외, 최대 5개). */
  tlsHostsSinceHttps: string[];
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

/**
 * 인증서를 고정(pinning)해 프록시 CA를 신뢰 설정과 무관하게 항상 거부하는 시스템 서비스 도메인.
 * iOS는 화면이 꺼져도 iCloud/Apple 서비스가 백그라운드로 접속하고, 이 연결의 TLS 실패는 정상이다.
 * "CA를 신뢰하지 않는다"는 근거로 세면 신뢰를 켠 기기도 미신뢰로 오판하므로 판정에서 제외한다.
 */
const PINNED_HOST_SUFFIXES = [
  'apple.com',
  'icloud.com',
  'icloud-content.com',
  'mzstatic.com',
  'apple-dns.net',
  'cdn-apple.com',
  'aaplimg.com',
  // Android: Google Play 서비스/연결 확인/동기화도 사용자 CA를 신뢰하지 않거나 인증서를 고정한다.
  'google.com',
  'googleapis.com',
  'gstatic.com',
  'gvt1.com',
  'gvt2.com',
  'android.com',
  'googleusercontent.com'
];

/** 인증서를 고정하는 것으로 알려진 시스템 호스트인지(서브도메인 포함). */
export function isPinnedHost(hostname: string | undefined): boolean {
  if (!hostname) return false;
  const host = hostname.toLowerCase();
  return PINNED_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

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
      c = { ip, platform: 'unknown', requestCount: 0, httpsCount: 0, lastSeenAt: 0, tlsErrorCount: 0, tlsHosts: [], lastHttpsAt: 0, tlsErrorsOther: 0, tlsHostsOther: [], lastTlsErrorAt: 0, tlsErrorsSinceHttps: 0, tlsHostsSinceHttps: [], local: LOCAL_IPS.has(ip) };
      map.set(ip, c);
    }
    return c;
  };

  for (const e of exchanges) {
    const ip = e.request.clientIp;
    if (!ip) continue;
    const c = entry(ip);
    c.requestCount++;
    if (e.request.url.startsWith('https:')) {
      c.httpsCount++;
      c.lastHttpsAt = Math.max(c.lastHttpsAt, e.startedAt);
    }
    c.lastSeenAt = Math.max(c.lastSeenAt, e.startedAt);
    const ua = parseUserAgent(userAgentOf(e));
    if (specificity(ua) > specificity(best.get(ip) ?? { platform: 'unknown' })) best.set(ip, ua);
  }

  // lastHttpsAt이 모두 정해진 뒤에 TLS 실패를 시간순으로 처리해야 "마지막 성공 이후"를 셀 수 있다.
  for (const t of [...tlsErrors].sort((a, b) => a.at - b.at)) {
    if (!t.clientIp) continue;
    const c = entry(t.clientIp);
    c.tlsErrorCount++;
    c.lastSeenAt = Math.max(c.lastSeenAt, t.at);
    if (t.hostname && !c.tlsHosts.includes(t.hostname)) c.tlsHosts = [t.hostname, ...c.tlsHosts].slice(0, 3);
    // 고정 시스템 호스트(iCloud 등)의 실패는 신뢰 설정과 무관하게 일어나므로 CA 미신뢰의 근거로 세지 않는다.
    if (isPinnedHost(t.hostname)) continue;
    c.tlsErrorsOther++;
    c.lastTlsErrorAt = Math.max(c.lastTlsErrorAt, t.at);
    if (t.hostname && !c.tlsHostsOther.includes(t.hostname)) c.tlsHostsOther = [t.hostname, ...c.tlsHostsOther].slice(0, 3);
    if (t.at > c.lastHttpsAt) {
      c.tlsErrorsSinceHttps++;
      if (t.hostname && !c.tlsHostsSinceHttps.includes(t.hostname)) {
        c.tlsHostsSinceHttps = [t.hostname, ...c.tlsHostsSinceHttps].slice(0, 5);
      }
    }
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

/** 복호화된 HTTPS가 한 번도 없을 때 미신뢰로 보려면 필요한 근거 실패 수(고정 호스트 제외). */
export const UNTRUSTED_MIN_ERRORS_NO_HTTPS = 2;
/** 이 시간(ms) 안에 TLS 실패가 있었을 때만 "미신뢰"로 본다(신뢰를 다시 켜면 곧 풀리게). */
export const UNTRUSTED_WINDOW_MS = 60_000;
/** 마지막 복호화 성공 이후 이만큼 실패하면 신뢰가 꺼진 것으로 본다. 인증서를 고정한 앱 1~2건의 실패와 구분한다. */
export const UNTRUSTED_MIN_ERRORS = 3;
/** 또는 서로 다른 호스트가 이만큼 실패하면(앱 하나가 아니라 CA 자체를 거부하는 신호). */
export const UNTRUSTED_MIN_HOSTS = 2;

/** Android(또는 USB 터널로 들어온 기기)용: 근거 실패 호스트가 이 수 이상이어야 미신뢰로 본다. */
export const ANDROID_UNTRUSTED_MIN_HOSTS = 3;

function isAndroidLike(client: ClientInfo): boolean {
  return client.platform === 'android' || client.local;
}

/**
 * 상태 판정. CA를 신뢰하지 않으면 모든 HTTPS 핸드셰이크가 실패한다.
 * - iCloud 등 인증서를 고정하는 시스템 호스트의 실패는 근거에서 뺀다(신뢰를 켜도 항상 실패하므로).
 * - 복호화된 HTTPS가 한 번도 없는데 근거 실패가 2회 이상이면 untrusted.
 * - 복호화에 성공한 적이 있더라도, 그 "이후" 최근(60초)에 여러 번(3회 이상) 또는 여러 호스트(2곳 이상)에서
 *   실패하면 untrusted: 신뢰 설정을 중간에 껐거나 CA가 바뀐 경우다. 과거 성공 기록이 있다는 이유로 가리지 않는다.
 * - 한두 호스트만 실패하고 다른 곳은 성공하는 경우(인증서 고정 앱)는 untrusted가 아니다.
 */
export function clientState(client: ClientInfo, now: number): ClientState {
  // Android는 API 24+ 앱 대부분이 사용자 CA를 아예 무시한다(앱별 opt-in). 앱 한두 개의 TLS 실패는 정상이므로,
  // 복호화된 HTTPS가 한 번도 없으면서 서로 다른 호스트 여러 곳이 최근에 실패할 때만 미신뢰로 본다.
  if (isAndroidLike(client)) {
    const recent = client.lastTlsErrorAt > 0 && now - client.lastTlsErrorAt <= UNTRUSTED_WINDOW_MS;
    if (recent && client.httpsCount === 0 && client.tlsHostsOther.length >= ANDROID_UNTRUSTED_MIN_HOSTS) return 'untrusted';
    return now - client.lastSeenAt <= ACTIVE_WINDOW_MS ? 'active' : 'idle';
  }
  if (client.tlsErrorsOther >= UNTRUSTED_MIN_ERRORS_NO_HTTPS && client.httpsCount === 0) return 'untrusted';
  const recent = client.lastTlsErrorAt > 0 && now - client.lastTlsErrorAt <= UNTRUSTED_WINDOW_MS;
  if (recent && (client.tlsErrorsSinceHttps >= UNTRUSTED_MIN_ERRORS || client.tlsHostsSinceHttps.length >= UNTRUSTED_MIN_HOSTS)) {
    return 'untrusted';
  }
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
