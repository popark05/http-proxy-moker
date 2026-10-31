import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, renderHook, act, waitFor } from '@testing-library/react';
import type { ProxyStatus } from '../../src/shared/capture';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn(() => 't'), dismiss: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { useProxyActions } from '../../src/renderer/src/state/useProxyActions';
import { CaptureControls } from '../../src/renderer/src/components/traffic/CaptureControls';
import { ProxyPanel } from '../../src/renderer/src/components/layout/ProxyPanel';
import { StatusBar } from '../../src/renderer/src/components/layout/StatusBar';

const api = { applyMocks: vi.fn(), clearMocks: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { mokerApi: unknown }).mokerApi = {
    proxy: api,
    onOperationProgress: () => () => {},
    device: { setupInstructions: vi.fn().mockResolvedValue([{ value: '192.168.0.5:8080' }]) }
  };
});

function setupHook(initial: ProxyStatus, startImpl: (port?: number) => Promise<ProxyStatus>, mode: 'capture' | 'mock' = 'capture') {
  const startProxy = vi.fn(startImpl);
  const stopProxy = vi.fn().mockResolvedValue({ running: false });
  const hook = renderHook(
    (p: { status: ProxyStatus; mode: 'capture' | 'mock' }) =>
      useProxyActions({ status: p.status, startProxy, stopProxy, mode: p.mode, mocks: [], blockUnmatched: false }),
    { initialProps: { status: initial, mode } }
  );
  return { hook, startProxy, stopProxy };
}

describe('ensureProxy (자동 시작)', () => {
  it('이미 켜져 있으면 다시 켜지 않는다', async () => {
    const { hook, startProxy } = setupHook({ running: true, port: 8080 }, async () => ({ running: true, port: 8080 }));
    const status = await hook.result.current.ensureProxy();
    expect(status).toEqual({ running: true, port: 8080 });
    expect(startProxy).not.toHaveBeenCalled();
  });

  it('동시에 여러 번 불러도 한 번만 켠다', async () => {
    let release!: (s: ProxyStatus) => void;
    const { hook, startProxy } = setupHook({ running: false }, () => new Promise((r) => (release = r)));
    let a!: Promise<unknown>, b!: Promise<unknown>;
    act(() => {
      a = hook.result.current.ensureProxy();
      b = hook.result.current.ensureProxy();
    });
    release({ running: true, port: 8080 });
    await act(async () => void (await Promise.all([a, b])));
    expect(startProxy).toHaveBeenCalledTimes(1);
  });

  it('기본 포트가 아닌 곳에서 시작되면 알려 준다', async () => {
    const { hook } = setupHook({ running: false }, async () => ({ running: true, port: 8082 }));
    await act(async () => void (await hook.result.current.ensureProxy()));
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('8082'), expect.anything());
  });

  it('실패하면 이유와 다시 시도 버튼을 보여 주고 undefined를 돌려준다', async () => {
    const { hook } = setupHook({ running: false }, async () => {
      throw new Error('EADDRINUSE');
    });
    let result: unknown = 'x';
    await act(async () => {
      result = await hook.result.current.ensureProxy();
    });
    expect(result).toBeUndefined();
    expect(toast.error).toHaveBeenCalledWith('프록시를 시작하지 못했습니다', expect.objectContaining({ description: 'EADDRINUSE', action: expect.objectContaining({ label: '다시 시도' }) }));
  });

  it('목킹 모드로 바꾸면 켜지만, 이미 목킹 모드에서 사용자가 끈 뒤에는 되살리지 않는다', async () => {
    const { hook, startProxy } = setupHook({ running: false }, async () => ({ running: true, port: 8080 }));
    hook.rerender({ status: { running: false }, mode: 'mock' });
    await waitFor(() => expect(startProxy).toHaveBeenCalledTimes(1));
    // 상태만 바뀌는 리렌더(사용자가 껐다)에서는 다시 켜지 않는다.
    hook.rerender({ status: { running: true, port: 8080 }, mode: 'mock' });
    hook.rerender({ status: { running: false }, mode: 'mock' });
    await Promise.resolve();
    expect(startProxy).toHaveBeenCalledTimes(1);
  });

  it('포트를 바꿔 다시 시작한다', async () => {
    const { hook, startProxy, stopProxy } = setupHook({ running: true, port: 8080 }, async (p) => ({ running: true, port: p ?? 8080 }));
    await act(async () => void (await hook.result.current.restartProxy(9000)));
    expect(stopProxy).toHaveBeenCalled();
    expect(startProxy).toHaveBeenCalledWith(9000);
  });
});

describe('CaptureControls', () => {
  it('프록시 시작/중지 버튼 없이 기록 일시중지만 다룬다', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<CaptureControls paused={false} onTogglePaused={onToggle} count={3} onClear={() => {}} />);
    expect(screen.queryByText(/프록시/)).toBeNull();
    fireEvent.click(screen.getByText(/기록 중/));
    expect(onToggle).toHaveBeenCalled();
    rerender(<CaptureControls paused onTogglePaused={onToggle} count={3} onClear={() => {}} />);
    expect(screen.getByText(/일시중지됨/)).toBeTruthy();
    expect(screen.getByText('3 건')).toBeTruthy();
  });
});

describe('StatusBar 프록시 표시', () => {
  const base = { mode: 'capture' as const, clientCount: 0, activeMockCount: 0, onOpenConnect: () => {}, onOpenProxy: vi.fn() };
  it('꺼져 있으면 자동으로 켜진다고 알리고, 누르면 패널을 연다', () => {
    render(<StatusBar {...base} proxy={{ running: false }} />);
    fireEvent.click(screen.getByRole('button', { name: '프록시 상태와 설정' }));
    expect(base.onOpenProxy).toHaveBeenCalled();
    expect(screen.getByText(/필요할 때 자동으로 켜집니다/)).toBeTruthy();
  });
  it('켜는 중과 수신 중을 구분한다', () => {
    const { rerender } = render(<StatusBar {...base} proxy={{ running: false }} proxyBusy="starting" />);
    expect(screen.getByText('프록시 켜는 중…')).toBeTruthy();
    rerender(<StatusBar {...base} proxy={{ running: true, port: 8081 }} />);
    expect(screen.getByText('프록시 :8081')).toBeTruthy();
  });
});

describe('ProxyPanel', () => {
  const props = { open: true, onOpenChange: () => {}, onStart: vi.fn(), onStop: vi.fn(), onRestart: vi.fn() };
  it('켜져 있으면 접속 주소를 보여 주고 포트를 바꿔 다시 시작한다', async () => {
    render(<ProxyPanel {...props} status={{ running: true, port: 8080 }} />);
    expect(await screen.findByText('192.168.0.5:8080')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('포트'), { target: { value: '9000' } });
    fireEvent.click(screen.getByText('포트 바꿔 다시 시작'));
    expect(props.onRestart).toHaveBeenCalledWith(9000);
  });
  it('꺼져 있으면 켜기, 잘못된 포트는 막는다', () => {
    render(<ProxyPanel {...props} status={{ running: false }} />);
    fireEvent.click(screen.getByText('켜기'));
    expect(props.onStart).toHaveBeenCalledWith(8080);
    fireEvent.change(screen.getByLabelText('포트'), { target: { value: '80' } });
    expect((screen.getByText('켜기').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
