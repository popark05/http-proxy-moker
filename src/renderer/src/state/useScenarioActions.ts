import { useEffect } from 'react';
import { toast } from 'sonner';
import type { MockDefinition } from '@shared/mock';
import { errMsg } from '../lib/errors';
import type { AppMode } from './app-mode';
import type { UseScenarioLibraryResult } from './useScenarioLibrary';

interface Params {
  scenarioLib: UseScenarioLibraryResult;
  hasProject: boolean;
  mode: AppMode;
}

/** 시나리오/케이스 관련 사용자 동작(저장·활성화·삭제·갱신)과 결과 토스트. */
export function useScenarioActions({ scenarioLib, hasProject, mode }: Params) {
  const { activeScenario } = scenarioLib;

  const saveScenario = async (name: string): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!hasProject) {
      toast.error('시나리오 저장 실패', { description: '프로젝트를 먼저 열거나 만드세요.' });
      return;
    }
    if (
      scenarioLib.scenarios.some((s) => s.name === trimmed) &&
      !window.confirm(`"${trimmed}" 시나리오를 현재 작업 공간 내용으로 덮어쓸까요?`)
    ) {
      return;
    }
    try {
      const saved = await scenarioLib.saveFromWorkspace(trimmed);
      toast.success('시나리오 저장됨', { description: `${saved} · 목이 케이스 라이브러리에 저장되었습니다` });
    } catch (e) {
      toast.error('시나리오 저장 실패', { description: errMsg(e) });
    }
  };

  const activateScenario = (name: string): void => {
    const { missing, cycle } = scenarioLib.activate(name);
    toast.success('시나리오 활성화', {
      description: mode === 'mock' ? `${name} 적용됨` : `${name} 로드됨 (목킹 모드에서 적용)`
    });
    if (cycle) toast.warning('베이스 상속이 순환합니다', { description: '시나리오 편집에서 베이스를 확인하세요.' });
    if (missing.length > 0) {
      toast.warning(`라이브러리에 없는 케이스 ${missing.length}개를 건너뜀`, { description: missing.join(', ') });
    }
  };

  const deleteScenario = async (name: string): Promise<void> => {
    if (!window.confirm(`"${name}" 시나리오를 삭제할까요? (케이스 라이브러리는 유지됩니다)`)) return;
    try {
      await scenarioLib.deleteScenario(name);
      toast('시나리오 삭제됨', { description: name });
    } catch (e) {
      toast.error('삭제할 수 없습니다', { description: errMsg(e) });
    }
  };

  const updateActiveScenario = async (): Promise<void> => {
    try {
      await scenarioLib.updateActiveFromWorkspace();
      toast.success('시나리오 갱신됨', { description: activeScenario });
    } catch (e) {
      toast.error('시나리오 갱신 실패', { description: errMsg(e) });
    }
  };

  const saveMockAsCase = async (mock: MockDefinition): Promise<void> => {
    if (!hasProject) {
      toast.error('케이스 저장 실패', { description: '프로젝트를 먼저 열거나 만드세요.' });
      return;
    }
    try {
      const { created, caseName } = await scenarioLib.saveMockAsCase(mock);
      toast.success(created ? '케이스로 저장됨' : '케이스에 반영됨', {
        description: `${mock.method} ${mock.path} · ${caseName}`
      });
    } catch (e) {
      toast.error('케이스 저장 실패', { description: errMsg(e) });
    }
  };

  const caseNameOf = (mock: MockDefinition): string | undefined => {
    const ref = mock.caseRef;
    if (!ref) return undefined;
    return scenarioLib.library.endpoints
      .find((e) => e.id === ref.endpointId)
      ?.cases.find((c) => c.id === ref.caseId)?.name;
  };

  // 프로젝트를 열 때 v1 시나리오가 변환되었다면 한 번 알린다.
  useEffect(() => {
    if (scenarioLib.migratedCount > 0) {
      toast.info(`시나리오 ${scenarioLib.migratedCount}개를 케이스 라이브러리 형식으로 변환했습니다`, {
        description: '원본은 scenarios/*.v1.bak으로 보관됩니다.'
      });
    }
  }, [scenarioLib.migratedCount]);

  return { saveScenario, activateScenario, deleteScenario, updateActiveScenario, saveMockAsCase, caseNameOf };
}
