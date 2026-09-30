import * as os from 'node:os';

type Interfaces = ReturnType<typeof os.networkInterfaces>;

export interface Ipv4Candidate {
  name: string;
  address: string;
}

/** 기기가 닿을 수 없는 가상/터널 어댑터 이름(VM·컨테이너·VPN·AirDrop 등). */
const VIRTUAL_NAME =
  /^(utun|awdl|llw|bridge|docker|veth|vboxnet|vmnet|virbr|br-|tun|tap|ppp|gif|stf|ap\d|anpi)|vethernet|virtualbox|vmware|hyper-v|wsl|loopback|tailscale|zerotier|vpn/i;

/** 물리 LAN 어댑터 이름(높을수록 우선): macOS en0/en1…, Windows Wi-Fi/Ethernet, Linux eth/wlan. */
function nameScore(name: string): number {
  if (/^en\d+$/.test(name) || /wi-?fi|wlan|wireless|ethernet|^eth\d|^enp|^wlp/i.test(name)) {
    return /^en0$/.test(name) ? 3 : 2;
  }
  return 1;
}

function isPrivate(ip: string): boolean {
  return ip.startsWith('192.168.') || ip.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

/**
 * 기기가 호스트 프록시에 접근할 때 쓸 수 있는 IPv4 후보를 우선순위 순으로 반환한다.
 * 링크로컬(169.254/16)과 가상 어댑터는 제외하고, 물리 LAN 어댑터 + 사설 대역을 앞에 둔다.
 */
export function listReachableIpv4(interfaces: Interfaces = os.networkInterfaces()): Ipv4Candidate[] {
  const candidates: Array<Ipv4Candidate & { score: number }> = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!addresses || VIRTUAL_NAME.test(name)) continue;
    for (const addr of addresses) {
      if (addr.family !== 'IPv4' || addr.internal || addr.address.startsWith('169.254.')) continue;
      candidates.push({
        name,
        address: addr.address,
        score: nameScore(name) * 2 + (isPrivate(addr.address) ? 1 : 0)
      });
    }
  }
  // sort는 안정 정렬이라 같은 점수는 어댑터 나열 순서를 유지한다.
  return candidates
    .sort((a, b) => b.score - a.score)
    .map(({ name, address }) => ({ name, address }));
}

/**
 * 가장 적합한 LAN IPv4 하나. `MOKER_PROXY_HOST` 환경변수가 있으면 그 값을 우선한다
 * (여러 NIC 환경에서 자동 선택이 틀릴 때의 수동 지정 수단). 없으면 undefined.
 */
export function getReachableIpv4(interfaces?: Interfaces): string | undefined {
  const override = process.env.MOKER_PROXY_HOST?.trim();
  if (override) return override;
  return listReachableIpv4(interfaces)[0]?.address;
}
