import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { withProgress } from '../../src/renderer/src/state/with-progress';
import { ProxyControls } from '../../src/renderer/src/components/traffic/ProxyControls';

const toast = vi.hoisted(() => {
  const fn = { loading: vi.fn(() => 'toast-1'), dismiss: vi.fn() };
  return fn;
});
vi.mock('sonner', () => ({ toast }));

let listener: ((p: { operation: string; step: string }) => void) | undefined;
const unsubscribe = vi.fn();
beforeEach(() => {
  toast.loading.mockClear();
  toast.dismiss.mockClear();
  unsubscribe.mockClear();
  listener = undefined;
  (window as unknown as { mokerApi: unknown }).mokerApi = {
    onOperationProgress: vi.fn((l: typeof listener) => {
      listener = l;
      return unsubscribe;
    })
  };
});

describe('withProgress', () => {
  it('진행 단계를 같은 토스트에 갱신하고, 끝나면 닫고 구독을 해제한다', async () => {
    const result = await withProgress('device:start:a', 'A 연결 중', async () => {
      listener?.({ operation: 'device:start:a', step: 'USB 터널 설정 중…' });
      listener?.({ operation: 'device:start:b', step: '다른 기기' }); // 다른 작업은 무시
      return 42;
    });
    expect(result).toBe(42);
    expect(toast.loading).toHaveBeenNthCalledWith(1, 'A 연결 중');
    expect(toast.loading).toHaveBeenNthCalledWith(2, 'A 연결 중 — USB 터널 설정 중…', { id: 'toast-1' });
    expect(toast.loading).toHaveBeenCalledTimes(2);
    expect(toast.dismiss).toHaveBeenCalledWith('toast-1');
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('작업이 실패해도 토스트를 닫고 오류를 그대로 던진다', async () => {
    await expect(
      withProgress('proxy:start', '프록시 시작 중', async () => {
        throw new Error('EADDRINUSE');
      })
    ).rejects.toThrow('EADDRINUSE');
    expect(toast.dismiss).toHaveBeenCalledWith('toast-1');
    expect(unsubscribe).toHaveBeenCalled();
  });
});

describe('ProxyControls busy', () => {
  const props = { count: 0, onStart: () => {}, onStop: () => {}, onClear: () => {} };

  it('시작 중에는 잠긴 "시작 중…" 버튼을, 중지 중에는 "중지 중…"을 보여준다', () => {
    const { rerender } = render(<ProxyControls {...props} status={{ running: false }} busy="starting" />);
    expect((screen.getByText('시작 중…').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('프록시 시작')).toBeNull();

    rerender(<ProxyControls {...props} status={{ running: true, port: 8080 }} busy="stopping" />);
    expect((screen.getByText('중지 중…').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/수신 중/)).toBeNull();
  });
});
