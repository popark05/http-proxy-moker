/**
 * 워크스페이스 탭 모델(순수 함수). React와 무관해서 단위 테스트로 규칙을 고정한다.
 *
 * - 같은 대상은 탭을 하나만 둔다(다시 열면 그 탭을 활성화).
 * - 고정되지 않은 탭은 "미리보기"다. 미리보기는 하나만 존재하고, 새 미리보기가 열리면 그 자리를 대신 쓴다.
 * - 편집 화면(시나리오·라이브러리·계약·목)은 입력 중인 내용이 사라지지 않도록 항상 고정으로 연다(요청 상세만 미리보기).
 */

export type TabTarget =
  /** 캡처된 요청·응답 상세. */
  | { kind: 'exchange'; id: string }
  /** 목 정의 + 시나리오 작업 공간(하나뿐). */
  | { kind: 'mocks' }
  /** 시나리오 편집. name이 null이면 새 시나리오. */
  | { kind: 'scenario'; name: string | null }
  /** 케이스 라이브러리 관리(하나뿐). */
  | { kind: 'library' }
  /** 계약 테스트(하나뿐). */
  | { kind: 'contracts' };

export type TabKind = TabTarget['kind'];

export interface Tab {
  key: string;
  target: TabTarget;
  /** false면 미리보기 탭(이탤릭, 다음 미리보기가 대체). */
  pinned: boolean;
}

export interface WorkbenchState {
  tabs: Tab[];
  activeKey: string | undefined;
}

export const EMPTY_WORKBENCH: WorkbenchState = { tabs: [], activeKey: undefined };

export function tabKey(target: TabTarget): string {
  switch (target.kind) {
    case 'exchange':
      return `exchange:${target.id}`;
    // 새 시나리오는 이름 있는 시나리오와 키가 겹치지 않도록 ':'가 없는 키를 쓴다.
    case 'scenario':
      return target.name === null ? 'scenario-new' : `scenario:${target.name}`;
    default:
      return target.kind;
  }
}

/**
 * 탭을 연다. 이미 있으면 활성화만 하고(pin이면 고정도 한다),
 * 없으면 pin이 아닐 때 기존 미리보기 자리에 끼워 넣고, 미리보기가 없으면 끝에 붙인다.
 */
export function openTab(state: WorkbenchState, target: TabTarget, options: { pin?: boolean } = {}): WorkbenchState {
  const key = tabKey(target);
  const pin = options.pin ?? false;
  const existing = state.tabs.find((t) => t.key === key);
  if (existing) {
    const tabs = pin && !existing.pinned ? state.tabs.map((t) => (t.key === key ? { ...t, pinned: true } : t)) : state.tabs;
    return { tabs, activeKey: key };
  }
  const tab: Tab = { key, target, pinned: pin };
  if (!pin) {
    const previewIndex = state.tabs.findIndex((t) => !t.pinned);
    if (previewIndex >= 0) {
      const tabs = [...state.tabs];
      tabs[previewIndex] = tab;
      return { tabs, activeKey: key };
    }
  }
  return { tabs: [...state.tabs, tab], activeKey: key };
}

/** 탭을 닫는다. 활성 탭을 닫으면 오른쪽 이웃, 없으면 왼쪽 이웃이 활성화된다. */
export function closeTab(state: WorkbenchState, key: string): WorkbenchState {
  const index = state.tabs.findIndex((t) => t.key === key);
  if (index < 0) return state;
  const tabs = state.tabs.filter((t) => t.key !== key);
  if (state.activeKey !== key) return { ...state, tabs };
  return { tabs, activeKey: (tabs[index] ?? tabs[index - 1])?.key };
}

/** 미리보기 탭을 고정한다. */
export function pinTab(state: WorkbenchState, key: string): WorkbenchState {
  if (!state.tabs.some((t) => t.key === key && !t.pinned)) return state;
  return { ...state, tabs: state.tabs.map((t) => (t.key === key ? { ...t, pinned: true } : t)) };
}

export function activateTab(state: WorkbenchState, key: string): WorkbenchState {
  return state.activeKey === key || !state.tabs.some((t) => t.key === key) ? state : { ...state, activeKey: key };
}

/** 활성 탭을 이전/다음으로 옮긴다(양 끝에서 순환). */
export function cycleTab(state: WorkbenchState, direction: 1 | -1): WorkbenchState {
  if (state.tabs.length < 2) return state;
  const index = state.tabs.findIndex((t) => t.key === state.activeKey);
  const next = (index + direction + state.tabs.length) % state.tabs.length;
  return { ...state, activeKey: state.tabs[next].key };
}

/** 탭 순서를 바꾼다(드래그 정렬). */
export function moveTab(state: WorkbenchState, fromKey: string, toKey: string): WorkbenchState {
  const from = state.tabs.findIndex((t) => t.key === fromKey);
  const to = state.tabs.findIndex((t) => t.key === toKey);
  if (from < 0 || to < 0 || from === to) return state;
  const tabs = [...state.tabs];
  const [moved] = tabs.splice(from, 1);
  tabs.splice(to, 0, moved);
  return { ...state, tabs };
}

/** 조건에 맞는 탭을 모두 닫는다(예: 캡처를 비우거나 세션을 불러올 때 요청 탭). */
export function closeTabsWhere(state: WorkbenchState, predicate: (tab: Tab) => boolean): WorkbenchState {
  let next = state;
  for (const tab of state.tabs) {
    if (predicate(tab)) next = closeTab(next, tab.key);
  }
  return next;
}
