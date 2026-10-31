import { toast } from 'sonner';
import type { CapturedExchange } from '@shared/capture';
import { contractsFromExchanges } from '@shared/contract';
import { errMsg } from '../lib/errors';
import type { AppMode } from './app-mode';
import type { UseContractsResult } from './useContracts';
import type { useMocks } from './useMocks';
import type { useProject } from './useProject';

interface Params {
  exchanges: CapturedExchange[];
  checkedIds: Set<string>;
  clearChecked: () => void;
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  mocksState: Pick<ReturnType<typeof useMocks>, 'cloneFromExchange' | 'cloneMany'>;
  contractState: UseContractsResult;
  project: ReturnType<typeof useProject>['project'];
  openContracts: () => void;
}

/** 캡처된 요청(들)을 목·계약·Bruno 컬렉션으로 보내는 동작과 결과 토스트. */
export function useExchangeActions({
  exchanges,
  checkedIds,
  clearChecked,
  mode,
  setMode,
  mocksState,
  contractState,
  project,
  openContracts
}: Params) {
  /** 체크된 요청들을 한 번에 목으로 복제. */
  const cloneChecked = (): void => {
    const targets = exchanges.filter((e) => checkedIds.has(e.id));
    const { added, skipped } = mocksState.cloneMany(targets);
    clearChecked();
    const detail = skipped > 0 ? ` (같은 method+path ${skipped}개는 건너뜀)` : '';
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

  /** 체크된 요청들을 계약으로 저장. */
  const saveContracts = async (): Promise<void> => {
    if (!project) {
      toast.error('계약 저장 실패', { description: '프로젝트를 먼저 열거나 만드세요. (상단 "열기" 또는 "새 프로젝트")' });
      return;
    }
    const targets = exchanges.filter((e) => checkedIds.has(e.id));
    try {
      const { saved, merged, skipped } = await contractState.saveFromExchanges(targets);
      clearChecked();
      const detail =
        (merged > 0 ? ` (이미 있는 ${merged}개는 응답 모양을 합침)` : '') +
        (skipped > 0 ? ` (응답이 없는 ${skipped}개는 건너뜀)` : '');
      if (saved === 0 && merged === 0) {
        toast.info('저장할 계약이 없습니다', { description: `응답이 있는 요청을 선택하세요${detail}` });
        return;
      }
      toast.success(saved > 0 ? `${saved}개 계약으로 저장됨` : '기존 계약에 합쳤습니다', {
        description: `contracts/ 폴더에 저장했습니다${detail}`,
        action: { label: '계약 테스트 열기', onClick: openContracts }
      });
    } catch (e) {
      toast.error('계약 저장 실패', { description: errMsg(e) });
    }
  };

  /** 체크된 요청들을 Bruno 컬렉션으로 바로 내보낸다(프로젝트 없이도 가능). 기존 컬렉션 폴더를 고르면 거기에 추가한다. */
  const exportBruno = async (): Promise<void> => {
    const targets = exchanges.filter((e) => checkedIds.has(e.id));
    const { contracts, skipped } = contractsFromExchanges(targets, () => `br-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    if (contracts.length === 0) {
      toast.info('내보낼 요청이 없습니다', { description: '응답이 있는 요청을 선택하세요' });
      return;
    }
    try {
      const out = await window.mokerApi.contract.exportBruno(project?.meta.name ?? 'EverMock', contracts, contractState.servers);
      if (!out) return;
      const notes = [
        out.existing > 0 ? `이미 있는 ${out.existing}개는 건너뜀` : '',
        skipped > 0 ? `응답 없는 ${skipped}개 제외` : ''
      ].filter(Boolean);
      toast.success(out.merged ? `기존 Bruno 컬렉션에 ${out.added}개 추가` : `Bruno 컬렉션 만듦 (${out.added}개 요청)`, {
        description: [out.dir, ...notes].join(' · ')
      });
    } catch (e) {
      toast.error('Bruno 내보내기 실패', { description: errMsg(e) });
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

  return { cloneChecked, saveContracts, exportBruno, cloneToMock };
}
