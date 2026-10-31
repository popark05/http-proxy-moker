import { useCallback, useEffect, useRef, useState } from 'react';
import type { CapturedExchange, ProxyStatus } from '@shared/capture';
import type { TlsErrorRecord } from '@shared/clients';
import { reduceCapture, addTag as addTagReducer, removeTag as removeTagReducer } from './capture-store';

/** 트래픽 목록이 지금 보여 주는 대상. */
export type CaptureView = { kind: 'live' } | { kind: 'saved'; name: string };

interface UseCaptureResult {
  /** 지금 보는 목록(실시간 또는 저장된 캡처). 필터·선택·복제 같은 화면 동작은 모두 이 목록을 대상으로 한다. */
  exchanges: CapturedExchange[];
  /** 실시간으로 쌓이는 목록(보는 대상과 무관). 접속 기기 진단과 저장에 쓴다. */
  liveExchanges: CapturedExchange[];
  /** 기기가 CA를 신뢰하지 않아 TLS 핸드셰이크가 실패한 기록(접속 기기 진단용). */
  tlsErrors: TlsErrorRecord[];
  status: ProxyStatus;
  /** true면 새 요청을 실시간 목록에 쌓지 않는다(프록시는 계속 통과시킨다). */
  paused: boolean;
  setPaused: (paused: boolean) => void;
  view: CaptureView;
  /** 저장된 캡처를 보는 동안 실시간에 새로 쌓인 요청 수. */
  newLiveCount: number;
  /** 저장된 캡처를 보기 시작한다(실시간 수집은 계속된다). */
  viewSaved: (name: string, exchanges: CapturedExchange[]) => void;
  backToLive: () => void;
  startProxy: (port?: number) => Promise<ProxyStatus>;
  stopProxy: () => Promise<ProxyStatus>;
  /** 실시간 목록을 비운다(저장된 캡처를 보는 중에도 실시간 쪽만 비운다). */
  clear: () => void;
  /** 지금 보는 목록의 exchange에 태그 추가. */
  addTag: (id: string, tag: string) => void;
  /** 지금 보는 목록의 exchange에서 태그 제거. */
  removeTag: (id: string, tag: string) => void;
}

interface SavedView {
  name: string;
  exchanges: CapturedExchange[];
  /** 보기 시작할 때의 실시간 개수(그 뒤로 쌓인 수를 "새 요청"으로 센다). */
  liveAtOpen: number;
}

/**
 * 프록시 상태 + 캡처된 exchange 목록을 관리하는 훅.
 * preload의 onCaptureEvent를 구독해 리듀서로 실시간 목록을 갱신한다. 저장된 캡처는 따로 들고 있어서
 * 저장본을 보는 동안에도 실시간 수집은 끊기지 않고, 돌아오면 그대로 이어진다.
 */
export function useCapture(): UseCaptureResult {
  const [live, setLive] = useState<CapturedExchange[]>([]);
  const [saved, setSaved] = useState<SavedView | undefined>(undefined);
  const [tlsErrors, setTlsErrors] = useState<TlsErrorRecord[]>([]);
  const [status, setStatus] = useState<ProxyStatus>({ running: false });
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  // 콜백을 다시 만들지 않고 최신 값을 읽기 위한 ref.
  const liveCountRef = useRef(0);
  liveCountRef.current = live.length;
  const savedRef = useRef<SavedView | undefined>(undefined);
  savedRef.current = saved;

  useEffect(() => {
    void window.mokerApi.proxy.status().then(setStatus);
    const unsubscribe = window.mokerApi.onCaptureEvent((event) => {
      if (event.type === 'tls-error') {
        // 최근 500건만 유지(핸드셰이크가 계속 실패하는 기기가 있어도 메모리가 늘지 않게).
        setTlsErrors((prev) => [...prev.slice(-499), { clientIp: event.clientIp, hostname: event.hostname, at: event.at }]);
        return;
      }
      // 일시중지 중에는 새 요청을 쌓지 않는다(기기 통신은 그대로 통과). 이미 쌓인 요청의 응답은 계속 반영한다.
      if (pausedRef.current && event.type === 'request') return;
      setLive((prev) => reduceCapture(prev, event));
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
    setLive([]);
    setTlsErrors([]);
  }, []);

  const viewSaved = useCallback((name: string, exchanges: CapturedExchange[]) => {
    setSaved((prev) => ({ name, exchanges, liveAtOpen: prev?.liveAtOpen ?? liveCountRef.current }));
  }, []);
  const backToLive = useCallback(() => setSaved(undefined), []);

  const addTag = useCallback((id: string, tag: string) => {
    setSaved((prev) => (prev ? { ...prev, exchanges: addTagReducer(prev.exchanges, id, tag) } : prev));
    setLive((prev) => (savedRef.current ? prev : addTagReducer(prev, id, tag)));
  }, []);

  const removeTag = useCallback((id: string, tag: string) => {
    setSaved((prev) => (prev ? { ...prev, exchanges: removeTagReducer(prev.exchanges, id, tag) } : prev));
    setLive((prev) => (savedRef.current ? prev : removeTagReducer(prev, id, tag)));
  }, []);
  return {
    exchanges: saved ? saved.exchanges : live,
    liveExchanges: live,
    tlsErrors,
    status,
    paused,
    setPaused,
    view: saved ? { kind: 'saved', name: saved.name } : { kind: 'live' },
    newLiveCount: saved ? Math.max(0, live.length - saved.liveAtOpen) : 0,
    viewSaved,
    backToLive,
    startProxy,
    stopProxy,
    clear,
    addTag,
    removeTag
  };
}
