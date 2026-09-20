import * as os from 'node:os';

/**
 * 기기가 맥의 프록시에 접근할 때 쓸 로컬 LAN IPv4 주소를 찾는다.
 * 여러 개면 첫 non-internal IPv4를 반환. 없으면 undefined.
 * (에뮬레이터는 adb reverse로 localhost를 쓰지만, 실기기 WiFi는 이 IP가 필요)
 */
export function getReachableIpv4(): string | undefined {
  const interfaces = os.networkInterfaces();
  const candidates: string[] = [];

  for (const addresses of Object.values(interfaces)) {
    if (!addresses) continue;
    for (const addr of addresses) {
      if (addr.family === 'IPv4' && !addr.internal) {
        candidates.push(addr.address);
      }
    }
  }

  // 사설 대역(192.168 / 10. / 172.16-31)을 우선.
  const preferred = candidates.find(
    (ip) => ip.startsWith('192.168.') || ip.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
  return preferred ?? candidates[0];
}
