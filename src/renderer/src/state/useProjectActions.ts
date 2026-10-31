import { toast } from 'sonner';
import type { CapturedExchange } from '@shared/capture';
import { errMsg } from '../lib/errors';
import type { useProject } from './useProject';

interface Params {
  projectState: ReturnType<typeof useProject>;
  exchanges: CapturedExchange[];
  replaceExchanges: (exchanges: CapturedExchange[]) => void;
  /** 세션을 불러오면 선택을 비운다. */
  onSessionLoaded: () => void;
}

/** 프로젝트 만들기/열기와 캡처 세션 저장/불러오기 동작(결과 토스트 포함). */
export function useProjectActions({ projectState, exchanges, replaceExchanges, onSessionLoaded }: Params) {
  const { createProject, openProject, saveCapture, loadCapture } = projectState;

  const handleCreateProject = async (name: string): Promise<void> => {
    try {
      await createProject(name);
    } catch (e) {
      toast.error('프로젝트 생성 실패', { description: errMsg(e) });
    }
  };

  const handleOpenProject = async (): Promise<void> => {
    try {
      await openProject();
    } catch (e) {
      toast.error('프로젝트 열기 실패', { description: errMsg(e) });
    }
  };

  const handleSaveCapture = async (name: string): Promise<void> => {
    try {
      await saveCapture(name, exchanges);
      toast.success('캡처 세션 저장됨', { description: `${name} · ${exchanges.length}건` });
    } catch (e) {
      toast.error('세션 저장 실패', { description: errMsg(e) });
    }
  };

  const handleLoadSession = async (name: string): Promise<void> => {
    try {
      const loaded = await loadCapture(name);
      replaceExchanges(loaded);
      onSessionLoaded();
      toast.success('세션 로드됨', { description: `${name} · ${loaded.length}건` });
    } catch (e) {
      toast.error('세션 로드 실패', { description: errMsg(e) });
    }
  };

  return { handleCreateProject, handleOpenProject, handleSaveCapture, handleLoadSession };
}
