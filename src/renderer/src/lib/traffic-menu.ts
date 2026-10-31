import { Copy, Filter, FolderPlus, History, Link, MonitorSmartphone, Radio, Save, SquareCheck, SquareMinus, Terminal, Trash2 } from 'lucide-react';
import type { CapturedExchange } from '@shared/capture';
import { toCurl } from '@shared/curl';
import type { TrafficFilter } from '@shared/traffic-filter';
import type { CaptureView } from '../state/useCapture';
import type { MenuItem } from '../components/primitives/ContextMenu';

export interface TrafficMenuActions {
  /** 목으로 복제(대상이 여럿이면 method+host+path당 최신 하나). */
  cloneToMock: (targets: CapturedExchange[]) => void;
  saveContracts: (targets: CapturedExchange[]) => void;
  patchFilter: (patch: Partial<TrafficFilter>) => void;
  copy: (text: string, what: string) => void;
  setChecked: (next: Set<string>) => void;
}

/**
 * 우클릭한 행이 체크된 항목 중 하나이고 체크가 둘 이상이면 체크된 전체가 대상이고,
 * 아니면 그 행(묶음 행이면 묶음 전체)만 대상이다(파일 탐색기와 같은 관례).
 */
export function menuTargets(
  row: readonly CapturedExchange[],
  all: readonly CapturedExchange[],
  checkedIds: ReadonlySet<string>
): CapturedExchange[] {
  const rowChecked = row.length > 0 && row.every((e) => checkedIds.has(e.id));
  if (rowChecked && checkedIds.size > 1) return all.filter((e) => checkedIds.has(e.id));
  return [...row];
}

/** 트래픽 행 우클릭 메뉴. row의 마지막 항목을 대표 요청(최신)으로 본다. */
export function buildRowMenu(
  row: readonly CapturedExchange[],
  all: readonly CapturedExchange[],
  checkedIds: ReadonlySet<string>,
  actions: TrafficMenuActions
): MenuItem[] {
  if (row.length === 0) return [];
  const targets = menuTargets(row, all, checkedIds);
  const n = targets.length;
  const primary = row[row.length - 1];
  const multi = n > 1 ? ` (${n}개)` : '';
  const items: MenuItem[] = [
    { label: `목으로 복제${multi}`, icon: Copy, onSelect: () => actions.cloneToMock(targets) },
    { label: `컬렉션에 추가${multi}`, icon: FolderPlus, onSelect: () => actions.saveContracts(targets) },
    { label: 'URL 복사', icon: Link, onSelect: () => actions.copy(primary.request.url, 'URL') },
    { label: 'cURL 복사', icon: Terminal, onSelect: () => actions.copy(toCurl(primary.request), 'cURL') }
  ];

  let host = '';
  try {
    host = new URL(primary.request.url).host;
  } catch {
    // 상대경로 등 호스트를 알 수 없는 요청.
  }
  if (host) items.push({ label: `${host}만 보기`, icon: Filter, onSelect: () => actions.patchFilter({ host }) });
  const clientIp = primary.request.clientIp;
  if (clientIp) items.push({ label: `${clientIp} 기기만 보기`, icon: MonitorSmartphone, onSelect: () => actions.patchFilter({ client: clientIp }) });

  const rowChecked = row.every((e) => checkedIds.has(e.id));
  items.push({
    label: rowChecked ? '선택 해제' : '선택에 추가',
    icon: rowChecked ? SquareMinus : SquareCheck,
    onSelect: () => {
      const next = new Set(checkedIds);
      for (const e of row) {
        if (rowChecked) next.delete(e.id);
        else next.add(e.id);
      }
      actions.setChecked(next);
    }
  });
  return items;
}

export interface SourceMenuActions {
  /** 실시간 목록을 저장된 캡처로 저장. */
  save: () => void;
  /** 저장된 캡처를 본다. */
  load: (name: string) => void;
  /** 실시간 목록으로 돌아간다. */
  backToLive: () => void;
  /** 실시간 목록을 비운다. */
  clear: () => void;
}

/**
 * 트래픽 "보기 대상" 메뉴(헤더 버튼과 목록 빈 곳 우클릭 공용).
 * 실시간과 저장된 캡처 중 무엇을 볼지 고르고, 실시간 목록을 저장하거나 비운다. 저장·비우기는 항상 실시간 목록 기준이다.
 */
export function buildSourceMenu(
  viewing: CaptureView,
  liveCount: number,
  saved: readonly string[],
  actions: SourceMenuActions
): MenuItem[] {
  const live = viewing.kind === 'live';
  return [
    { label: live ? '실시간 (보는 중)' : '실시간으로 돌아가기', icon: Radio, onSelect: actions.backToLive, disabled: live },
    ...saved.map((name) => {
      const current = !live && viewing.name === name;
      return {
        label: current ? `저장된 캡처 보는 중: ${name}` : `저장된 캡처 보기: ${name}`,
        icon: History,
        onSelect: () => actions.load(name),
        disabled: current
      };
    }),
    { label: '실시간 목록 저장', icon: Save, onSelect: actions.save, disabled: liveCount === 0 },
    { label: '실시간 목록 비우기', icon: Trash2, onSelect: actions.clear, destructive: true, disabled: liveCount === 0 }
  ];
}
