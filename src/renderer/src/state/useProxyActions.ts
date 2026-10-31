import { useEffect, useState } from 'react';
import { toast } from 'sonner';
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

/** 프록시 시작/중지 동작과, 모드·목·정책 변경 시 프록시에 목킹을 적용/해제하는 동기화. */
export function useProxyActions({ status, startProxy, stopProxy, mode, mocks, blockUnmatched }: Params) {
  const [proxyBusy, setProxyBusy] = useState<'starting' | 'stopping' | undefined>();

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

  const handleStartProxy = async (): Promise<void> => {
    setProxyBusy('starting');
    try {
      const next = await withProgress(operationId.proxyStart, '프록시 시작 중', () => startProxy());
      toast.success('프록시 시작', { description: `포트 ${next?.port ?? ''} 수신 중` });
    } catch (e) {
      toast.error('프록시 시작 실패', { description: errMsg(e) });
    } finally {
      setProxyBusy(undefined);
    }
  };

  const handleStopProxy = async (): Promise<void> => {
    setProxyBusy('stopping');
    try {
      await withProgress(operationId.proxyStop, '프록시 중지 중', () => stopProxy());
      toast('프록시 중지됨');
    } catch (e) {
      toast.error('프록시 중지 실패', { description: errMsg(e) });
    } finally {
      setProxyBusy(undefined);
    }
  };

  return { proxyBusy, handleStartProxy, handleStopProxy };
}
