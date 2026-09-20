import { useCallback, useEffect, useState } from 'react';
import type { CapturedExchange, ProxyStatus } from '@shared/capture';
import { reduceCapture, addTag as addTagReducer, removeTag as removeTagReducer } from './capture-store';

interface UseCaptureResult {
  exchanges: CapturedExchange[];
  status: ProxyStatus;
  startProxy: (port?: number) => Promise<ProxyStatus>;
  stopProxy: () => Promise<ProxyStatus>;
  clear: () => void;
  /** 저장된 세션 등 외부 exchange 목록으로 교체(로드용). */
  replaceExchanges: (exchanges: CapturedExchange[]) => void;
  /** exchange에 태그 추가. */
  addTag: (id: string, tag: string) => void;
  /** exchange에서 태그 제거. */
  removeTag: (id: string, tag: string) => void;
}

/**
 * 프록시 상태 + 캡처된 exchange 목록을 관리하는 훅.
 * preload의 onCaptureEvent를 구독해 리듀서로 목록을 갱신한다.
 */
export function useCapture(): UseCaptureResult {
  const [exchanges, setExchanges] = useState<CapturedExchange[]>([]);
  const [status, setStatus] = useState<ProxyStatus>({ running: false });

  useEffect(() => {
    void window.mokerApi.proxy.status().then(setStatus);
    const unsubscribe = window.mokerApi.onCaptureEvent((event) => {
      setExchanges((prev) => reduceCapture(prev, event));
    });
    return unsubscribe;
  }, []);

  const startProxy = useCallback(async (port?: number) => {
    const next = await window.mokerApi.proxy.start(port ? { port } : undefined);
    setStatus(next);
    return next;
  }, []);

  const stopProxy = useCallback(async () => {
    const next = await window.mokerApi.proxy.stop();
    setStatus(next);
    return next;
  }, []);

  const clear = useCallback(() => setExchanges([]), []);
  const replaceExchanges = useCallback((next: CapturedExchange[]) => setExchanges(next), []);

  const addTag = useCallback((id: string, tag: string) => {
    setExchanges((prev) => addTagReducer(prev, id, tag));
  }, []);

  const removeTag = useCallback((id: string, tag: string) => {
    setExchanges((prev) => removeTagReducer(prev, id, tag));
  }, []);

  return {
    exchanges,
    status,
    startProxy,
    stopProxy,
    clear,
    replaceExchanges,
    addTag,
    removeTag
  };
}
