import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { CaptureEvent, CapturedExchange } from '../../src/shared/capture';
import { useCapture } from '../../src/renderer/src/state/useCapture';

let emit: (event: CaptureEvent) => void = () => {};

beforeEach(() => {
  (window as unknown as { mokerApi: unknown }).mokerApi = {
    proxy: { status: () => Promise.resolve({ running: true, port: 8080 }) },
    onCaptureEvent: (listener: (e: CaptureEvent) => void) => {
      emit = listener;
      return () => {};
    }
  };
});

const ex = (id: string): CapturedExchange => ({
  id,
  startedAt: 1,
  request: { method: 'GET', url: `https://a.com/${id}`, path: `/${id}`, headers: [], body: { encoding: 'empty', content: '', byteLength: 0 } }
});
const req = (id: string): CaptureEvent => ({ type: 'request', exchange: ex(id) });
const ids = (list: CapturedExchange[]): string[] => list.map((e) => e.id);

describe('useCapture 보기 대상', () => {
  it('저장된 캡처를 보는 동안에도 실시간은 계속 쌓이고, 돌아오면 이어진다', async () => {
    const { result } = renderHook(() => useCapture());
    act(() => emit(req('a')));
    act(() => result.current.viewSaved('어제', [ex('old1'), ex('old2')]));

    expect(result.current.view).toEqual({ kind: 'saved', name: '어제' });
    expect(ids(result.current.exchanges)).toEqual(['old1', 'old2']);
    expect(result.current.newLiveCount).toBe(0);

    act(() => emit(req('b')));
    act(() => emit(req('c')));
    expect(ids(result.current.exchanges)).toEqual(['old1', 'old2']); // 보는 목록은 그대로
    expect(ids(result.current.liveExchanges)).toEqual(['a', 'b', 'c']);
    expect(result.current.newLiveCount).toBe(2);

    act(() => result.current.backToLive());
    expect(result.current.view).toEqual({ kind: 'live' });
    expect(ids(result.current.exchanges)).toEqual(['a', 'b', 'c']);
    expect(result.current.newLiveCount).toBe(0);
  });

  it('저장본에서 다른 저장본으로 옮겨도 "새 요청" 기준은 처음 보기 시작한 시점이다', () => {
    const { result } = renderHook(() => useCapture());
    act(() => emit(req('a')));
    act(() => result.current.viewSaved('s1', [ex('x')]));
    act(() => emit(req('b')));
    act(() => result.current.viewSaved('s2', [ex('y')]));
    expect(result.current.newLiveCount).toBe(1);
  });

  it('clear는 실시간만 비운다(저장본을 보는 중에도)', () => {
    const { result } = renderHook(() => useCapture());
    act(() => emit(req('a')));
    act(() => result.current.viewSaved('s1', [ex('x')]));
    act(() => result.current.clear());
    expect(ids(result.current.exchanges)).toEqual(['x']);
    expect(result.current.liveExchanges).toEqual([]);
    expect(result.current.newLiveCount).toBe(0);
  });

  it('태그는 지금 보는 목록에만 붙는다', () => {
    const { result } = renderHook(() => useCapture());
    act(() => emit(req('a')));
    act(() => result.current.viewSaved('s1', [ex('x')]));
    act(() => result.current.addTag('x', '버그'));
    expect(result.current.exchanges[0].tags).toEqual(['버그']);
    expect(result.current.liveExchanges[0].tags).toBeUndefined();
    act(() => result.current.backToLive());
    act(() => result.current.addTag('a', '확인'));
    expect(result.current.exchanges[0].tags).toEqual(['확인']);
  });

  it('일시중지는 실시간 수집에만 적용된다', () => {
    const { result } = renderHook(() => useCapture());
    act(() => result.current.setPaused(true));
    act(() => emit(req('a')));
    expect(result.current.liveExchanges).toEqual([]);
    act(() => result.current.setPaused(false));
    act(() => emit(req('b')));
    expect(ids(result.current.liveExchanges)).toEqual(['b']);
  });
});
