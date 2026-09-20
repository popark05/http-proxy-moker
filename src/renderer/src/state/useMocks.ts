import { useCallback, useState } from 'react';
import type { CapturedExchange } from '@shared/capture';
import type { MockDefinition, MockScenario } from '@shared/mock';
import { exchangeToMock } from '@shared/mock-convert';

interface UseMocksResult {
  mocks: MockDefinition[];
  /** 캡처 exchange를 목으로 복제해 추가. 생성된 목 반환. */
  cloneFromExchange: (exchange: CapturedExchange) => MockDefinition;
  updateMock: (mock: MockDefinition) => void;
  removeMock: (id: string) => void;
  /** 현재 목들을 시나리오로 저장. 저장된 시나리오명 반환. */
  saveScenario: (name: string, description?: string) => Promise<string>;
  /** 저장된 시나리오를 로드해 목 목록으로 설정. */
  loadScenario: (name: string) => Promise<void>;
}

function randomId(): string {
  return `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 목 정의 목록과 시나리오 저장/로드를 관리하는 훅. */
export function useMocks(): UseMocksResult {
  const [mocks, setMocks] = useState<MockDefinition[]>([]);

  const cloneFromExchange = useCallback((exchange: CapturedExchange): MockDefinition => {
    const mock = exchangeToMock(exchange, randomId());
    setMocks((prev) => [...prev, mock]);
    return mock;
  }, []);

  const updateMock = useCallback((mock: MockDefinition) => {
    setMocks((prev) => prev.map((m) => (m.id === mock.id ? mock : m)));
  }, []);

  const removeMock = useCallback((id: string) => {
    setMocks((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const saveScenario = useCallback(
    async (name: string, description?: string): Promise<string> => {
      const scenario: MockScenario = {
        version: 1,
        id: randomId(),
        name,
        description,
        mocks
      };
      return window.mokerApi.project.saveScenario(scenario);
    },
    [mocks]
  );

  const loadScenario = useCallback(async (name: string) => {
    const scenario = await window.mokerApi.project.loadScenario(name);
    setMocks(scenario.mocks);
  }, []);

  return { mocks, cloneFromExchange, updateMock, removeMock, saveScenario, loadScenario };
}
