import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DEFAULT_PROXY_PORT } from '@shared/ipc';
import type { ProxyStatus } from '@shared/capture';
import type { MockDefinition } from '@shared/mock';
import { operationId } from '@shared/progress';
import { errMsg } from '../lib/errors';
import type { AppMode } from './app-mode';
import { withProgress } from './with-progress';

interface Params {
  status: ProxyStatus;
  startProxy: (port?: number) => Promise<ProxyStatus>;
  stopProxy: () => Promise<ProxyStatus>;
  mode: AppMode;
  mocks: MockDefinition[];
  blockUnmatched: boolean;
}

/**
 * 프록시 생명주기와, 모드·목·정책 변경 시 프록시에 목킹을 적용/해제하는 동기화.
 *
 * 프록시는 사용자가 따로 켜는 대상이 아니라 필요한 동작(기기 인터셉트, 목킹, 수동 프록시 안내)이
 * `ensureProxy`로 켠다. 이미 켜져 있거나 켜는 중이면 같은 결과를 공유한다.
 */
export function useProxyActions({ status, startProxy, stopProxy, mode, mocks, blockUnmatched }: Params) {
  const [proxyBusy, setProxyBusy] = useState<'starting' | 'stopping' | undefined>();
  const statusRef = useRef(status);
  statusRef.current = status;
  const startRef = useRef(startProxy);
  startRef.current = startProxy;
  const inflight = useRef<Promise<ProxyStatus | undefined> | null>(null);

  // 모드/목/정책 변경 시 프록시에 목킹 적용 or 해제.
  useEffect(() => {
    if (!status.running) return;
    if (mode === 'mock') {
      void window.mokerApi.proxy.applyMocks({
        mocks,
        unmatchedPolicy: blockUnmatched ? 'block' : 'passthrough'
      });
    } else {
      void window.mokerApi.proxy.clearMocks();
    }
  }, [mode, mocks, blockUnmatched, status.running]);

  /** 포트를 지정하면 그 포트로만 시작한다(사용 중이면 오류). 생략하면 기본 포트에서 빈 포트를 찾는다. */
  const ensureProxy = useCallback(async (port?: number): Promise<ProxyStatus | undefined> => {
    if (statusRef.current.running) return statusRef.current;
    if (inflight.current) return inflight.current;
    const run = (async (): Promise<ProxyStatus | undefined> => {
      setProxyBusy('starting');
      try {
        const next = await withProgress(operationId.proxyStart, '프록시 켜는 중', () => startRef.current(port));
        if (port === undefined && next?.port !== undefined && next.port !== DEFAULT_PROXY_PORT) {
          toast.info(`포트 ${DEFAULT_PROXY_PORT}이(가) 사용 중이라 ${next.port}에서 시작했습니다`, {
            description: '이미 연결한 기기는 다시 인터셉트해야 할 수 있습니다.'
          });
        }
        return next;
      } catch (e) {
        toast.error('프록시를 시작하지 못했습니다', {
          description: errMsg(e),
          action: { label: '다시 시도', onClick: () => void ensureProxy(port) }
        });
        return undefined;
      } finally {
        setProxyBusy(undefined);
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  }, []);

  // 목킹 모드로 들어가면 프록시가 필요하다(모드를 바꾼 순간에만 켠다 — 사용자가 직접 끈 직후 되살리지 않는다).
  useEffect(() => {
    if (mode === 'mock') void ensureProxy();
  }, [mode, ensureProxy]);

  const handleStopProxy = async (): Promise<void> => {
    setProxyBusy('stopping');
    try {
      await withProgress(operationId.proxyStop, '프록시 중지 중', () => stopProxy());
      toast('프록시를 껐습니다', { description: '연결한 기기의 네트워크가 끊길 수 있습니다.' });
    } catch (e) {
      toast.error('프록시 중지 실패', { description: errMsg(e) });
    } finally {
      setProxyBusy(undefined);
    }
  };

  /** 중지 후 (필요하면 새 포트로) 다시 시작. */
  const restartProxy = async (port?: number): Promise<void> => {
    setProxyBusy('stopping');
    try {
      await withProgress(operationId.proxyStop, '프록시 중지 중', () => stopProxy());
    } catch (e) {
      toast.error('프록시 중지 실패', { description: errMsg(e) });
      setProxyBusy(undefined);
      return;
    }
    setProxyBusy(undefined);
    statusRef.current = { running: false };
    const next = await ensureProxy(port);
    if (next?.running) toast.success('프록시를 다시 켰습니다', { description: `포트 ${next.port}` });
  };

  return { proxyBusy, ensureProxy, handleStopProxy, restartProxy };
}
