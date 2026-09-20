// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  urlSafeBase64,
  buildSetupParams,
  buildConnectUrl,
  decodeConnectData
} from '../../src/main/device/android/vpn-activation';
import { EMULATOR_HOST_IPS, CONNECT_URL_BASE } from '../../src/shared/android-vpn';

describe('urlSafeBase64', () => {
  it('+와 /를 모두 -와 _로 치환', () => {
    // 0xFF 바이트들은 base64에서 +,/ 를 만든다.
    const encoded = urlSafeBase64('\u00ff\u00ff\u00ff\u00fe');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
  });

  it('디코딩 라운드트립', () => {
    const original = '{"a":"안녕","b":[1,2,3]}';
    const encoded = urlSafeBase64(original);
    const restored = Buffer.from(
      encoded.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf8');
    expect(restored).toBe(original);
  });
});

describe('buildSetupParams', () => {
  it('에뮬레이터 IP를 앞에, LAN IP를 뒤에 붙인다', () => {
    const params = buildSetupParams({
      proxyPort: 8080,
      localTunnelPort: 8080,
      certFingerprint: 'FP',
      reachableIps: ['192.168.0.10']
    });
    expect(params.addresses).toEqual([...EMULATOR_HOST_IPS, '192.168.0.10']);
    expect(params.port).toBe(8080);
    expect(params.localTunnelPort).toBe(8080);
    expect(params.certFingerprint).toBe('FP');
    expect(params.enableSocks).toBe(false);
  });
});

describe('buildConnectUrl / decodeConnectData', () => {
  it('connect URL을 만들고 다시 디코딩하면 파라미터가 보존된다', () => {
    const params = buildSetupParams({
      proxyPort: 8080,
      localTunnelPort: 8080,
      certFingerprint: 'abc123+/def',
      reachableIps: ['10.1.2.3']
    });
    const url = buildConnectUrl(params);

    expect(url.startsWith(CONNECT_URL_BASE)).toBe(true);
    expect(url).toContain('?data=');

    const decoded = decodeConnectData(url);
    expect(decoded).toEqual(params);
    expect(decoded.certFingerprint).toBe('abc123+/def');
  });
});
