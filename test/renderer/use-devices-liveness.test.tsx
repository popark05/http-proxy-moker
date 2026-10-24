import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDevices } from '../../src/renderer/src/state/useDevices';
import type { DeviceInfo, InterceptionResult } from '../../src/shared/device';
import type { InterceptionLiveness } from '../../src/shared/interception-liveness';

const phone: DeviceInfo = { id: 'R3', platform: 'android', name: 'R3', status: 'ready' };
const started: InterceptionResult = { deviceId: 'R3', proxyConfigured: true, caInstalled: true, warnings: [], usedMode: 'vpn' };

let observed: InterceptionLiveness;
const interceptionStatus = vi.fn(async () => observed);

beforeEach(() => {
  vi.useFakeTimers();
  observed = 'inactive';
  interceptionStatus.mockReset();
  interceptionStatus.mockImplementation(async () => observed);
  (window as unknown as { mokerApi: unknown }).mokerApi = {
    device: {
      list: vi.fn(async () => [phone]),
      startInterception: vi.fn(async () => started),
      stopInterception: vi.fn(async () => {}),
      interceptionStatus
    }
  };
});
afterEach(() => vi.useRealTimers());

/** 5초 주기를 한 번 진행하고 비동기 작업이 끝나길 기다린다. */
const tick = async (): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
};

async function startedHook(onInterceptionLost = vi.fn()) {
  const hook = renderHook(() => useDevices({ onInterceptionLost }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await hook.result.current.start(phone, 'vpn', 'usb');
  });
  return { hook, onInterceptionLost };
}

describe('useDevices 인터셉션 생존 확인', () => {
  it('활성이 확인된 뒤 companion에서 연결을 끊으면 활성 목록에서 내리고 알린다', async () => {
    const { hook, onInterceptionLost } = await startedHook();
    expect(hook.result.current.interceptions.R3).toBeDefined();

    observed = 'active';
    await tick();
    expect(hook.result.current.interceptions.R3).toBeDefined();

    observed = 'inactive'; // 사용자가 companion 앱에서 Disconnect
    await tick();
    expect(hook.result.current.interceptions.R3).toBeDefined(); // 첫 비활성은 보류
    await tick();
    expect(hook.result.current.interceptions.R3).toBeUndefined();
    expect(onInterceptionLost).toHaveBeenCalledTimes(1);
    expect(onInterceptionLost).toHaveBeenCalledWith(phone);

    await tick(); // 이후에는 더 확인하지 않는다
    expect(onInterceptionLost).toHaveBeenCalledTimes(1);
  });

  it('VPN 허용을 기다리는 동안(활성을 본 적 없음)에는 끊긴 것으로 보지 않는다', async () => {
    const { hook, onInterceptionLost } = await startedHook();
    observed = 'inactive';
    for (let i = 0; i < 4; i++) await tick();
    expect(hook.result.current.interceptions.R3).toBeDefined();
    expect(onInterceptionLost).not.toHaveBeenCalled();
  });

  it('확인이 실패해도(adb 오류) 상태를 바꾸지 않는다', async () => {
    const { hook, onInterceptionLost } = await startedHook();
    observed = 'active';
    await tick();
    interceptionStatus.mockRejectedValue(new Error('adb'));
    for (let i = 0; i < 4; i++) await tick();
    expect(hook.result.current.interceptions.R3).toBeDefined();
    expect(onInterceptionLost).not.toHaveBeenCalled();
  });
});
