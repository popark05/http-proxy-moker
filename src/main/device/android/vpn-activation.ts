import {
  CONNECT_URL_BASE,
  EMULATOR_HOST_IPS,
  type CompanionSetupParams
} from '@shared/android-vpn';

/**
 * URL-safe base64 인코딩.
 * companion 앱은 Base64.decode(data, URL_SAFE)로 디코딩하므로 '+'→'-', '/'→'_' 를
 * 모두(전역) 치환해야 한다. (원본 서버 구현은 replace 첫항목만 바꾸는 잠재 버그가 있어 replaceAll 사용)
 * URL_SAFE 디코더는 패딩('=')을 허용하므로 패딩은 유지해도 무방하다.
 */
export function urlSafeBase64(content: string): string {
  return Buffer.from(content, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** companion 앱에 넘길 셋업 파라미터를 만든다. */
export function buildSetupParams(args: {
  proxyPort: number;
  localTunnelPort?: number;
  certFingerprint: string;
  /** 호스트의 도달 가능한 LAN IPv4 목록(에뮬레이터 IP는 자동 prepend). */
  reachableIps: string[];
  enableSocks?: boolean;
}): CompanionSetupParams {
  return {
    // 에뮬레이터 호스트 IP를 먼저, 그다음 실기기용 LAN IP.
    addresses: [...EMULATOR_HOST_IPS, ...args.reachableIps],
    port: args.proxyPort,
    localTunnelPort: args.localTunnelPort,
    enableSocks: args.enableSocks ?? false,
    certFingerprint: args.certFingerprint
  };
}

/** 셋업 파라미터로 companion 앱 activate 인텐트의 data URL을 만든다. */
export function buildConnectUrl(params: CompanionSetupParams): string {
  const data = urlSafeBase64(JSON.stringify(params));
  return `${CONNECT_URL_BASE}?data=${data}`;
}

/** connect URL의 data 파라미터를 디코딩(테스트/검증용). */
export function decodeConnectData(url: string): CompanionSetupParams {
  const match = /[?&]data=([^&]+)/.exec(url);
  if (!match) throw new Error('connect URL에 data 파라미터가 없습니다.');
  const b64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
  const json = Buffer.from(b64, 'base64').toString('utf8');
  return JSON.parse(json) as CompanionSetupParams;
}
