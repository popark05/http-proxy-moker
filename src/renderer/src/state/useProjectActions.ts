import { toast } from '@/lib/toast';
import type { CapturedExchange } from '@shared/capture';
import { errMsg } from '../lib/errors';
import type { useProject } from './useProject';

interface Params {
  projectState: ReturnType<typeof useProject>;
  /** 저장 대상(실시간 목록). */
  liveExchanges: CapturedExchange[];
  /** 저장된 캡처를 보기 시작한다. */
  viewSaved: (name: string, exchanges: CapturedExchange[]) => void;
  /** 저장된 캡처를 보기 시작하면 선택을 비운다. */
  onSessionLoaded: () => void;
}

/** 프로젝트 만들기/열기와 저장된 캡처 저장/불러오기 동작(결과 토스트 포함). */
export function useProjectActions({ projectState, liveExchanges, viewSaved, onSessionLoaded }: Params) {
  const { createProject, openProject, saveCapture, loadCapture } = projectState;

  const handleCreateProject = async (): Promise<void> => {
    try {
      await createProject();
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
      await saveCapture(name, liveExchanges);
      toast.success('캡처 저장됨', { description: `${name} · ${liveExchanges.length}건` });
    } catch (e) {
      toast.error('캡처 저장 실패', { description: errMsg(e) });
    }
  };

  const handleLoadSession = async (name: string): Promise<void> => {
    try {
      const loaded = await loadCapture(name);
      viewSaved(name, loaded);
      onSessionLoaded();
      toast.success('저장된 캡처를 보는 중', { description: `${name} · ${loaded.length}건` });
    } catch (e) {
      toast.error('저장된 캡처 불러오기 실패', { description: errMsg(e) });
    }
  };

  return { handleCreateProject, handleOpenProject, handleSaveCapture, handleLoadSession };
}
