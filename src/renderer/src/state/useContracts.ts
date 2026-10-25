import { useCallback, useEffect, useState } from 'react';
import type { CapturedExchange } from '@shared/capture';
import {
  exchangeToContract,
  mergeContractSample,
  sameRequest,
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
  saveFromExchanges: (exchanges: CapturedExchange[]) => Promise<{ saved: number; merged: number; skipped: number }>;
  /** 편집한 계약을 같은 이름으로 저장. */
  updateContract: (contract: Contract) => Promise<void>;
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
      let list = contracts;
      let saved = 0;
      let merged = 0;
      let skipped = 0;
      for (const exchange of exchanges) {
        const draft = exchangeToContract(exchange, randomId());
        if (!draft) {
          skipped++;
          continue;
        }
        // 같은 요청을 다시 저장하면 새 계약을 늘리지 않고 기존 계약에 샘플을 합친다.
        const same = list.find((c) => sameRequest(c, draft));
        if (same) {
          const next = mergeContractSample(same, draft);
          await window.mokerApi.project.saveContract(next);
          list = list.map((c) => (c.name === same.name ? next : c));
          merged++;
          continue;
        }
        const name = uniqueContractName(list.map((c) => c.name), draft.name);
        const savedName = await window.mokerApi.project.saveContract({ ...draft, name });
        list = [...list, { ...draft, name: savedName }];
        saved++;
      }
      setContracts(list);
      return { saved, merged, skipped };
    },
    [contracts]
  );

  const updateContract = useCallback(async (contract: Contract) => {
    await window.mokerApi.project.saveContract(contract);
    setContracts((prev) => prev.map((c) => (c.name === contract.name ? contract : c)));
  }, []);

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

  return { contracts, servers, saveFromExchanges, updateContract, removeContract, upsertServer, removeServer };
}
