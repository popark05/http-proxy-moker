import { useEffect, useMemo, useState } from 'react';
import type { CapturedExchange } from '@shared/capture';
import { aggregateClients, type ClientInfo, type TlsErrorRecord } from '@shared/clients';

/** "N초 전"/상태가 시간에 따라 바뀌므로 이 주기로 현재 시각을 갱신한다. */
const TICK_MS = 2000;

/** 프록시에 접속한 기기 목록과 갱신되는 현재 시각. */
export function useClients(
  exchanges: CapturedExchange[],
  tlsErrors: TlsErrorRecord[]
): { clients: ClientInfo[]; now: number } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const clients = useMemo(() => aggregateClients(exchanges, tlsErrors), [exchanges, tlsErrors]);
  return { clients, now };
}
