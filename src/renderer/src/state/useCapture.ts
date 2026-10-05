import { useCallback, useEffect, useState } from 'react';
import type { CapturedExchange, ProxyStatus } from '@shared/capture';
import type { TlsErrorRecord } from '@shared/clients';
import { reduceCapture, addTag as addTagReducer, removeTag as removeTagReducer } from './capture-store';

interface UseCaptureResult {
  exchanges: CapturedExchange[];
  /** 기기가 CA를 신뢰하지 않아 TLS 핸드셰이크가 실패한 기록(접속 기기 진단용). */
  tlsErrors: TlsErrorRecord[];
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
  const [tlsErrors, setTlsErrors] = useState<TlsErrorRecord[]>([]);
  const [status, setStatus] = useState<ProxyStatus>({ running: false });

  useEffect(() => {
    void window.mokerApi.proxy.status().then(setStatus);
    const unsubscribe = window.mokerApi.onCaptureEvent((event) => {
      if (event.type === 'tls-error') {
        // 최근 500건만 유지(핸드셰이크가 계속 실패하는 기기가 있어도 메모리가 늘지 않게).
        setTlsErrors((prev) => [...prev.slice(-499), { clientIp: event.clientIp, hostname: event.hostname, at: event.at }]);
        return;
      }
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

  const clear = useCallback(() => {
    setExchanges([]);
    setTlsErrors([]);
  }, []);
  const replaceExchanges = useCallback((next: CapturedExchange[]) => {
    setExchanges(next);
    // 저장된 세션을 불러온 경우 이전 실시간 TLS 진단은 의미가 없다.
    setTlsErrors([]);
  }, []);

  const addTag = useCallback((id: string, tag: string) => {
    setExchanges((prev) => addTagReducer(prev, id, tag));
  }, []);

  const removeTag = useCallback((id: string, tag: string) => {
    setExchanges((prev) => removeTagReducer(prev, id, tag));
  }, []);

  return {
    exchanges,
    tlsErrors,
    status,
    startProxy,
    stopProxy,
    clear,
    replaceExchanges,
    addTag,
    removeTag
  };
}
