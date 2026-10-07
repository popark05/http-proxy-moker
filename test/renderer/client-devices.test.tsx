import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import type { CaptureEvent, CapturedExchange } from '../../src/shared/capture';
import type { ClientInfo } from '../../src/shared/clients';
import { ClientList, formatAgo } from '../../src/renderer/src/components/device/ClientList';
import { FilterBar } from '../../src/renderer/src/components/traffic/FilterBar';
import { TrafficList } from '../../src/renderer/src/components/traffic/TrafficList';
import { useCapture } from '../../src/renderer/src/state/useCapture';

const client = (over: Partial<ClientInfo> = {}): ClientInfo => ({
  ip: '192.168.45.12',
  platform: 'ios',
  model: 'iPhone',
  osVersion: '17.4',
  requestCount: 12,
  httpsCount: 8,
  lastSeenAt: 100_000,
  tlsErrorCount: 0,
  tlsHosts: [],
  lastHttpsAt: 100_000,
  lastTlsErrorAt: 0,
  tlsErrorsSinceHttps: 0,
  tlsHostsSinceHttps: [],
  local: false,
  ...over
});

const baseProps = { devices: [], proxyRunning: true, onFilter: () => {}, activeFilter: undefined, onIosSetup: () => {} };

describe('formatAgo', () => {
  it('상대 시간 표기', () => {
    expect(formatAgo(1000)).toBe('방금');
    expect(formatAgo(12_000)).toBe('12초 전');
    expect(formatAgo(3 * 60_000)).toBe('3분 전');
    expect(formatAgo(2 * 3_600_000)).toBe('2시간 전');
  });
});

describe('ClientList', () => {
  it('Wi-Fi로 접속한 iPhone을 모델/IP/요청 수/수신 중 상태와 함께 보여준다', () => {
    render(<ClientList {...baseProps} clients={[client()]} now={102_000} />);
    expect(screen.getByText('iPhone · iOS 17.4')).toBeTruthy();
    expect(screen.getByText(/192\.168\.45\.12 · 12건 · 방금/)).toBeTruthy();
    expect(screen.getByText('수신 중')).toBeTruthy();
  });

  it('한동안 트래픽이 없으면 대기', () => {
    render(<ClientList {...baseProps} clients={[client()]} now={200_000} />);
    expect(screen.getByText('대기')).toBeTruthy();
  });

  it('HTTPS가 복호화되지 않고 TLS가 실패하면 인증서 미신뢰 안내와 셋업 가이드 링크를 보여준다', () => {
    const onIosSetup = vi.fn();
    render(
      <ClientList
        {...baseProps}
        onIosSetup={onIosSetup}
        clients={[client({ httpsCount: 0, requestCount: 0, tlsErrorCount: 4, tlsHosts: ['api.a.com'] })]}
        now={101_000}
      />
    );
    expect(screen.getByText('인증서 미신뢰')).toBeTruthy();
    expect(screen.getByText(/인증서 신뢰 설정/)).toBeTruthy();
    expect(screen.getByText(/api\.a\.com/)).toBeTruthy();
    fireEvent.click(screen.getByText('iOS 셋업 가이드 열기'));
    expect(onIosSetup).toHaveBeenCalled();
  });

  it('신뢰를 중간에 끈 iPhone(과거 복호화 성공 있음)도 최근 실패가 이어지면 미신뢰로 표시하고 실패 호스트를 보여준다', () => {
    render(
      <ClientList
        {...baseProps}
        now={110_000}
        clients={[client({ tlsErrorCount: 5, lastTlsErrorAt: 109_000, tlsErrorsSinceHttps: 5, tlsHostsSinceHttps: ['b.com', 'a.com'], tlsHosts: ['b.com', 'a.com'] })]}
      />
    );
    expect(screen.getByText('인증서 미신뢰')).toBeTruthy();
    expect(screen.getByText(/실패한 호스트: b\.com, a\.com/)).toBeTruthy();
  });

  it('일부 호스트만 TLS 실패하면(복호화된 HTTPS 있음) 미신뢰가 아니라 참고 문구만', () => {
    render(<ClientList {...baseProps} clients={[client({ tlsErrorCount: 2, tlsHosts: ['pin.a.com'] })]} now={101_000} />);
    expect(screen.queryByText('인증서 미신뢰')).toBeNull();
    expect(screen.getByText(/인증서를 고정한 앱/)).toBeTruthy();
  });

  it('접속 IP가 없는 요청이 있으면 프록시 재시작 안내를 보여준다', () => {
    render(<ClientList {...baseProps} clients={[]} now={0} untrackedCount={175} />);
    expect(screen.getByText(/접속 기기를 알 수 없는 요청 175건/)).toBeTruthy();
    expect(screen.getByText('중지 후 다시 시작')).toBeTruthy();
  });

  it('접속 기기가 없으면 안내(프록시 실행 여부에 따라 문구가 다름)', () => {
    const { rerender } = render(<ClientList {...baseProps} clients={[]} now={0} />);
    expect(screen.getByText(/Wi-Fi 프록시를 이 PC 주소로/)).toBeTruthy();
    rerender(<ClientList {...baseProps} proxyRunning={false} clients={[]} now={0} />);
    expect(screen.getByText(/프록시를 시작하면/)).toBeTruthy();
  });

  it('"이 기기만"으로 필터를 걸고, 걸린 기기는 "전체 보기"로 해제한다', () => {
    const onFilter = vi.fn();
    const { rerender } = render(<ClientList {...baseProps} onFilter={onFilter} clients={[client()]} now={101_000} />);
    fireEvent.click(screen.getByText('이 기기만'));
    expect(onFilter).toHaveBeenCalledWith('192.168.45.12');
    rerender(<ClientList {...baseProps} onFilter={onFilter} activeFilter="192.168.45.12" clients={[client()]} now={101_000} />);
    expect(screen.getByText('전체 보기')).toBeTruthy();
  });

  it('조치가 필요한 인증서 미신뢰 기기를 맨 위에 둔다', () => {
    const { container } = render(
      <ClientList
        {...baseProps}
        now={101_000}
        clients={[
          client({ ip: '10.0.0.1', lastSeenAt: 100_900 }),
          client({ ip: '10.0.0.2', httpsCount: 0, requestCount: 0, tlsErrorCount: 3, lastSeenAt: 90_000, platform: 'unknown', model: undefined, osVersion: undefined })
        ]}
      />
    );
    const rows = [...container.querySelectorAll('.font-mono.text-2xs')].map((e) => e.textContent ?? '');
    expect(rows[0]).toContain('10.0.0.2');
    expect(rows[1]).toContain('10.0.0.1');
    // 플랫폼을 모르는 미신뢰 기기에도 셋업 가이드 링크가 보인다.
    expect(screen.getByText('iOS 셋업 가이드 열기')).toBeTruthy();
  });

  it('127.0.0.1 접속은 USB 연결로 표시', () => {
    render(<ClientList {...baseProps} clients={[client({ ip: '127.0.0.1', local: true, platform: 'android', model: undefined, osVersion: undefined })]} now={101_000} />);
    expect(screen.getByText('USB 연결 기기(adb)')).toBeTruthy();
  });
});

describe('FilterBar 기기 필터', () => {
  const props = { filter: {}, patchFilter: vi.fn(), clearFilter: () => {}, active: false, hosts: [], tags: [], total: 0, shown: 0 };

  it('접속 기기가 둘 이상일 때만 필터를 보여주고 선택하면 client 필터를 건다', () => {
    const patch = vi.fn();
    const clients = [
      { ip: '1.1.1.1', label: 'iPhone' },
      { ip: '2.2.2.2', label: 'Pixel' }
    ];
    const { rerender } = render(<FilterBar {...props} patchFilter={patch} clients={[clients[0]]} />);
    fireEvent.click(screen.getByLabelText('필터 펼치기'));
    expect(screen.queryByLabelText('기기 필터')).toBeNull();
    rerender(<FilterBar {...props} patchFilter={patch} clients={clients} />);
    fireEvent.change(screen.getByLabelText('기기 필터'), { target: { value: '2.2.2.2' } });
    expect(patch).toHaveBeenCalledWith({ client: '2.2.2.2' });
  });
});

describe('TrafficList 기기 아이콘', () => {
  // jsdom은 레이아웃이 없어 가상 스크롤이 행을 그리지 않으므로 목록 영역 크기를 흉내 낸다.
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 400 });
    Element.prototype.getBoundingClientRect = () => ({ width: 400, height: 600, top: 0, left: 0, right: 400, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
  });
  const ex = (id: string, ip: string): CapturedExchange => ({
    id,
    startedAt: 1,
    request: { method: 'GET', url: 'https://a.com/x', path: '/x', headers: [], body: { encoding: 'empty', content: '', byteLength: 0 }, clientIp: ip },
    response: undefined
  });
  it('기기가 둘 이상일 때 행에 플랫폼 아이콘을 보여준다', () => {
    const platforms = new Map([['1.1.1.1', 'ios' as const], ['2.2.2.2', 'android' as const]]);
    const { container, rerender } = render(<TrafficList exchanges={[ex('a', '1.1.1.1')]} selectedId={undefined} onSelect={() => {}} clientPlatforms={platforms} />);
    expect(container.querySelector('svg.lucide-apple')).toBeTruthy();
    rerender(<TrafficList exchanges={[ex('a', '1.1.1.1')]} selectedId={undefined} onSelect={() => {}} clientPlatforms={new Map([['1.1.1.1', 'ios' as const]])} />);
    expect(container.querySelector('svg.lucide-apple')).toBeNull();
  });
});

describe('useCapture tls-error', () => {
  it('tls-error 이벤트를 exchange와 분리해 기록하고, clear/replace 시 비운다', () => {
    let listener: (e: CaptureEvent) => void = () => {};
    (window as unknown as { mokerApi: unknown }).mokerApi = {
      proxy: { status: vi.fn(async () => ({ running: false })) },
      onCaptureEvent: (l: (e: CaptureEvent) => void) => {
        listener = l;
        return () => {};
      }
    };
    const { result } = renderHook(() => useCapture());
    act(() => listener({ type: 'tls-error', clientIp: '192.168.0.9', hostname: 'a.com', at: 5 }));
    expect(result.current.tlsErrors).toEqual([{ clientIp: '192.168.0.9', hostname: 'a.com', at: 5 }]);
    expect(result.current.exchanges).toEqual([]);
    act(() => result.current.clear());
    expect(result.current.tlsErrors).toEqual([]);
  });
});
