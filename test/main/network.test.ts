import { describe, expect, it, afterEach } from 'vitest';
import { getReachableIpv4, listReachableIpv4 } from '../../src/main/device/network';

const v4 = (address: string, internal = false) =>
  ({ address, family: 'IPv4', internal, netmask: '', mac: '', cidr: null }) as never;

describe('listReachableIpv4', () => {
  it('가상 어댑터와 링크로컬을 제외하고 en0/Wi-Fi를 우선한다', () => {
    const list = listReachableIpv4({
      'vEthernet (WSL)': [v4('172.20.0.1')],
      bridge100: [v4('192.168.64.1')],
      utun3: [v4('10.8.0.2')],
      en5: [v4('169.254.10.1')],
      lo0: [v4('127.0.0.1', true)],
      en1: [v4('192.168.1.20')],
      en0: [v4('10.0.0.7')]
    });
    expect(list.map((c) => c.address)).toEqual(['10.0.0.7', '192.168.1.20']);
  });

  it('Windows 어댑터 이름에서 Wi-Fi를 VirtualBox보다 우선한다', () => {
    const list = listReachableIpv4({
      'VirtualBox Host-Only Network': [v4('192.168.56.1')],
      'Wi-Fi': [v4('192.168.0.9')]
    });
    expect(list).toEqual([{ name: 'Wi-Fi', address: '192.168.0.9' }]);
  });

  it('사설 대역이 공인 대역보다 앞선다', () => {
    const list = listReachableIpv4({ eth0: [v4('8.8.4.4')], eth1: [v4('192.168.0.2')] });
    expect(list[0].address).toBe('192.168.0.2');
  });

  it('후보가 없으면 undefined', () => {
    expect(getReachableIpv4({ lo0: [v4('127.0.0.1', true)] })).toBeUndefined();
  });
});

describe('getReachableIpv4 override', () => {
  afterEach(() => delete process.env.MOKER_PROXY_HOST);
  it('MOKER_PROXY_HOST가 자동 선택보다 우선한다', () => {
    process.env.MOKER_PROXY_HOST = '10.1.1.1';
    expect(getReachableIpv4({ en0: [v4('192.168.0.2')] })).toBe('10.1.1.1');
  });
});
