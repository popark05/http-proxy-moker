import { useCallback, useState } from 'react';
import type { CapturedExchange } from '@shared/capture';
import type { MockDefinition } from '@shared/mock';
import { exchangeToMock, pickExchangesToClone } from '@shared/mock-convert';

interface UseMocksResult {
  mocks: MockDefinition[];
  /** 캡처 exchange를 목으로 복제해 추가. 생성된 목 반환. */
  cloneFromExchange: (exchange: CapturedExchange) => MockDefinition;
  /** 여러 exchange를 한 번에 복제(같은 method+path 중복은 건너뜀). */
  cloneMany: (exchanges: CapturedExchange[]) => { added: number; skipped: number };
  updateMock: (mock: MockDefinition) => void;
  removeMock: (id: string) => void;
  /** 작업 공간의 목 목록을 통째로 교체(시나리오 활성화). */
  replaceMocks: (mocks: MockDefinition[]) => void;
}

function randomId(): string {
  return `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 목 정의 목록과 시나리오 저장/로드를 관리하는 훅. */
export function useMocks(): UseMocksResult {
  const [mocks, setMocks] = useState<MockDefinition[]>([]);

  const cloneFromExchange = useCallback((exchange: CapturedExchange): MockDefinition => {
    const mock = exchangeToMock(exchange, randomId());
    // 업데이터를 멱등하게: StrictMode(dev)에서 업데이터가 2번 호출돼도 같은 mock이
    // 중복 추가되지 않도록 id 존재 여부를 가드한다.
    setMocks((prev) => (prev.some((m) => m.id === mock.id) ? prev : [...prev, mock]));
    return mock;
  }, []);

  const cloneMany = useCallback(
    (exchanges: CapturedExchange[]): { added: number; skipped: number } => {
      const { targets, skipped } = pickExchangesToClone(exchanges, mocks);
      if (targets.length > 0) {
        const created = targets.map((ex) => exchangeToMock(ex, randomId()));
        setMocks((prev) => [...prev, ...created]);
      }
      return { added: targets.length, skipped };
    },
    [mocks]
  );

  const updateMock = useCallback((mock: MockDefinition) => {
    setMocks((prev) => prev.map((m) => (m.id === mock.id ? mock : m)));
  }, []);

  const removeMock = useCallback((id: string) => {
    setMocks((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const replaceMocks = useCallback((next: MockDefinition[]) => setMocks(next), []);

  return { mocks, cloneFromExchange, cloneMany, updateMock, removeMock, replaceMocks };
}
