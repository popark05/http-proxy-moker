import { useCallback, useEffect, useState } from 'react';
import type { CapturedExchange } from '@shared/capture';
import {
  exchangeToContract,
  normalizeBaseUrl,
  uniqueContractName,
  type Contract,
  type ContractServer
} from '@shared/contract';

function randomId(): string {
  return `ct-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface UseContractsResult {
  contracts: Contract[];
  servers: ContractServer[];
  /** 캡처 exchange들을 계약으로 저장. 응답이 없는 것은 skipped. */
  saveFromExchanges: (exchanges: CapturedExchange[]) => Promise<{ saved: number; skipped: number }>;
  removeContract: (name: string) => Promise<void>;
  /** 서버 등록/갱신. 주소가 올바르지 않으면 false. */
  upsertServer: (server: ContractServer) => Promise<boolean>;
  removeServer: (name: string) => Promise<void>;
}

/** 열린 프로젝트의 계약과 실행 대상 서버 상태. 변경은 즉시 디스크에 반영한다. */
export function useContracts(projectDir: string | undefined): UseContractsResult {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [servers, setServers] = useState<ContractServer[]>([]);

  useEffect(() => {
    if (!projectDir) {
      setContracts([]);
      setServers([]);
      return;
    }
    let cancelled = false;
    void Promise.all([window.mokerApi.project.loadAllContracts(), window.mokerApi.project.loadContractServers()])
      .then(([c, s]) => {
        if (cancelled) return;
        setContracts(c);
        setServers(s);
      })
      .catch(() => {
        // 읽기 실패는 빈 목록으로 둔다.
      });
    return () => {
      cancelled = true;
    };
  }, [projectDir]);

  const saveFromExchanges = useCallback(
    async (exchanges: CapturedExchange[]) => {
      const names = contracts.map((c) => c.name);
      const added: Contract[] = [];
      let skipped = 0;
      for (const exchange of exchanges) {
        const draft = exchangeToContract(exchange, randomId());
        if (!draft) {
          skipped++;
          continue;
        }
        const name = uniqueContractName(names, draft.name);
        names.push(name);
        const savedName = await window.mokerApi.project.saveContract({ ...draft, name });
        added.push({ ...draft, name: savedName });
      }
      setContracts((prev) => [...prev, ...added]);
      return { saved: added.length, skipped };
    },
    [contracts]
  );

  const removeContract = useCallback(async (name: string) => {
    await window.mokerApi.project.deleteContract(name);
    setContracts((prev) => prev.filter((c) => c.name !== name));
  }, []);

  const upsertServer = useCallback(
    async (server: ContractServer) => {
      const baseUrl = normalizeBaseUrl(server.baseUrl);
      const name = server.name.trim();
      if (!baseUrl || !name) return false;
      const next = [...servers.filter((s) => s.name !== name), { name, baseUrl }];
      await window.mokerApi.project.saveContractServers(next);
      setServers(next);
      return true;
    },
    [servers]
  );

  const removeServer = useCallback(
    async (name: string) => {
      const next = servers.filter((s) => s.name !== name);
      await window.mokerApi.project.saveContractServers(next);
      setServers(next);
    },
    [servers]
  );

  return { contracts, servers, saveFromExchanges, removeContract, upsertServer, removeServer };
}
