import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConnectionWizard } from '../../src/renderer/src/components/device/ConnectionWizard';
import type { DeviceInfo } from '../../src/shared/device';

// hairline은 DOM 드로잉 라이브러리라 jsdom에서는 빈 상자로 대체한다.
vi.mock('@lucasmarkes/hairline/react', () => {
  const fig = (name: string) => () => <div data-testid={`figure-${name}`} />;
  return { Phone: fig('phone'), Laptop: fig('laptop'), Router: fig('router'), Padlock: fig('padlock') };
});

const exportCa = vi.fn();
beforeEach(() => {
  exportCa.mockReset();
  (window as unknown as { mokerApi: unknown }).mokerApi = {
    device: { setupInstructions: vi.fn(async () => [{ where: 'device', title: 't', detail: 'd', value: '192.168.0.5:8080' }]) },
    ca: { export: exportCa }
  };
});

const baseInput = { proxyRunning: true, devices: [] as DeviceInfo[], interceptions: {}, clients: [], now: 1_000_000 };
const props = { open: true, onOpenChange: () => {} };

describe('ConnectionWizard', () => {
  it('세 탭을 보여주고 프록시가 꺼져 있으면 첫 단계를 현재로 안내한다', () => {
    render(<ConnectionWizard {...props} input={{ ...baseInput, proxyRunning: false }} />);
    expect(screen.getByRole('tab', { name: 'Android · USB' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Android · Wi-Fi' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'iPhone/iPad · Wi-Fi' })).toBeTruthy();
    expect(screen.getByLabelText('지금 할 일')).toBeTruthy();
    expect(screen.getByText(/0\/6 단계 완료/)).toBeTruthy();
  });

  it('기기 상태가 단계 체크에 반영된다(USB 디버깅 미승인 → 확인 필요)', () => {
    const devices: DeviceInfo[] = [{ id: 'R3', platform: 'android', name: 'R3', status: 'unauthorized' }];
    render(<ConnectionWizard {...props} input={{ ...baseInput, devices }} />);
    expect(screen.getByLabelText('확인 필요')).toBeTruthy();
    expect(screen.getByText(/USB 디버깅 허용을 눌러/)).toBeTruthy();
  });

  it('iOS 탭: 프록시 주소와 프로파일 내보내기 버튼을 보여준다', async () => {
    render(<ConnectionWizard {...props} initialTab="ios-wifi" input={baseInput} />);
    await waitFor(() => expect(screen.getAllByText('192.168.0.5:8080').length).toBeGreaterThan(0));
    // 프로파일 단계는 아직 대기라 버튼이 숨겨져 있다가, 앞 단계가 끝나면 나타난다.
    expect(screen.queryByText(/\.mobileconfig/)).toBeNull();
  });

  it('Android Wi-Fi 탭은 두 방식을 전환할 수 있다', () => {
    render(<ConnectionWizard {...props} initialTab="android-usb" input={baseInput} />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Android · Wi-Fi' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Android · Wi-Fi' }));
    fireEvent.click(screen.getByText('수동 프록시 (adb 없이)'));
    expect(screen.getByText('Wi-Fi 프록시를 수동으로 설정')).toBeTruthy();
  });
});
