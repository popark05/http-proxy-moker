import { toast } from 'sonner';
import type { CapturedExchange } from '@shared/capture';
import { errMsg } from '../lib/errors';
import type { AppMode } from './app-mode';
import type { UseContractsResult } from './useContracts';
import type { useMocks } from './useMocks';
import type { useProject } from './useProject';

interface Params {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  mocksState: Pick<ReturnType<typeof useMocks>, 'cloneFromExchange' | 'cloneMany'>;
  contractState: UseContractsResult;
  project: ReturnType<typeof useProject>['project'];
  openCollection: () => void;
}

/** 캡처된 요청(들)을 목·컬렉션으로 보내는 동작과 결과 토스트. */
export function useExchangeActions({
  mode,
  setMode,
  mocksState,
  contractState,
  project,
  openCollection
}: Params) {
  /** 요청들을 한 번에 목으로 복제. */
  const cloneExchanges = (targets: CapturedExchange[]): void => {
    const { added, skipped } = mocksState.cloneMany(targets);
    const detail = skipped > 0 ? ` (같은 method+host+path ${skipped}개는 건너뜀)` : '';
    if (added === 0) {
      toast.info('새로 복제할 목이 없습니다', {
        description: `이미 목이 있는 요청이거나 중복입니다${detail}`
      });
      return;
    }
    if (mode === 'mock') {
      toast.success(`${added}개 목으로 복제됨`, { description: `목 정의에 추가됨${detail}` });
    } else {
      toast.success(`${added}개 목으로 복제됨`, {
        description: `목킹 모드로 전환하면 반영됩니다${detail}`,
        action: { label: '목킹 모드로', onClick: () => setMode('mock') }
      });
    }
  };

  /** 요청들을 컬렉션(프로젝트의 contracts/ 폴더)에 추가. */
  const saveContracts = async (targets: CapturedExchange[]): Promise<void> => {
    if (!project) {
      toast.error('컬렉션 추가 실패', { description: '프로젝트를 먼저 열거나 만드세요. (상단 "열기" 또는 "새 프로젝트")' });
      return;
    }
    try {
      const { saved, merged, skipped } = await contractState.saveFromExchanges(targets);
      const detail =
        (merged > 0 ? ` (이미 있는 ${merged}개는 응답 모양을 합침)` : '') +
        (skipped > 0 ? ` (응답이 없는 ${skipped}개는 건너뜀)` : '');
      if (saved === 0 && merged === 0) {
        toast.info('추가할 요청이 없습니다', { description: `응답이 있는 요청을 선택하세요${detail}` });
        return;
      }
      toast.success(saved > 0 ? `${saved}개 요청을 컬렉션에 추가함` : '기존 요청에 합쳤습니다', {
        description: `contracts/ 폴더에 저장했습니다${detail}`,
        action: { label: '컬렉션 열기', onClick: openCollection }
      });
    } catch (e) {
      toast.error('컬렉션 추가 실패', { description: errMsg(e) });
    }
  };

  /** 요청 하나를 목으로 복제. */
  const cloneToMock = (exchange: CapturedExchange): void => {
    mocksState.cloneFromExchange(exchange);
    const desc = `${exchange.request.method} ${exchange.request.path}`;
    if (mode === 'mock') {
      toast.success('목으로 복제됨', { description: `${desc} · 목 정의에 추가됨(왼쪽 프로젝트 > 목)` });
    } else {
      // 캡처 모드면 목킹 모드 전환을 한 번의 클릭으로 유도(제품 핵심 흐름).
      toast.success('목으로 복제됨', {
        description: `${desc} · 목킹 모드로 전환하면 이 응답이 반영됩니다`,
        action: { label: '목킹 모드로', onClick: () => setMode('mock') }
      });
    }
  };

  return { cloneExchanges, saveContracts, cloneToMock };
}
