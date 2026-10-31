/**
 * 커맨드 팔레트 모델(순수 함수): 열 수 있는 대상과 실행할 동작을 한 목록으로 모으고, 검색어로 걸러 정렬한다.
 */
import type { CapturedExchange } from '@shared/capture';
import type { Contract } from '@shared/contract';
import type { MockDefinition } from '@shared/mock';
import type { CaseLibrary, ScenarioV2 } from '@shared/scenario-library';
import type { AppMode } from '../state/app-mode';
import type { SidebarSection } from '../components/layout/sidebar-sections';
import type { Tab } from './workbench';

export type CommandGroup = '열린 탭' | '이동' | '요청' | '목' | '시나리오' | '계약' | '세션' | '동작';

export interface Command {
  id: string;
  group: CommandGroup;
  label: string;
  /** 검색에만 쓰는 추가 단어(라벨에 없는 이름 등). */
  keywords?: string;
  /** 오른쪽에 흐리게 보여 주는 보조 설명. */
  hint?: string;
  run: () => void;
}

export interface CommandInput {
  tabs: Tab[];
  describeTab: (tab: Tab) => { label: string; method?: string };
  exchanges: CapturedExchange[];
  mocks: MockDefinition[];
  scenarios: ScenarioV2[];
  activeScenario: string | undefined;
  library: CaseLibrary;
  contracts: Contract[];
  captureSessions: string[];
  hasProject: boolean;
  mode: AppMode;
  proxyRunning: boolean;
  activeTabKey: string | undefined;
  actions: {
    activateTab: (key: string) => void;
    openSection: (section: SidebarSection) => void;
    openExchange: (id: string) => void;
    openMocks: () => void;
    openScenario: (name: string | null) => void;
    activateScenario: (name: string) => void;
    openLibrary: () => void;
    openContracts: () => void;
    loadSession: (name: string) => void;
    startProxy: () => void;
    stopProxy: () => void;
    setMode: (mode: AppMode) => void;
    closeActiveTab: () => void;
    clearCapture: () => void;
  };
}

export function buildCommands(input: CommandInput): Command[] {
  const { actions: a } = input;
  const out: Command[] = [];

  for (const tab of input.tabs) {
    const { label, method } = input.describeTab(tab);
    out.push({
      id: `tab:${tab.key}`,
      group: '열린 탭',
      label: method ? `${method} ${label}` : label,
      hint: tab.key === input.activeTabKey ? '현재 탭' : undefined,
      run: () => a.activateTab(tab.key)
    });
  }

  out.push(
    { id: 'go:traffic', group: '이동', label: '트래픽 보기', keywords: 'traffic', run: () => a.openSection('traffic') },
    {
      id: 'go:project',
      group: '이동',
      label: '프로젝트 트리 보기',
      keywords: 'project tree',
      run: () => a.openSection('project')
    },
    {
      id: 'go:connect',
      group: '이동',
      label: '기기 연결 보기',
      keywords: 'device connect',
      run: () => a.openSection('connect')
    },
    { id: 'go:mocks', group: '이동', label: '목 · 시나리오 열기', keywords: 'mock scenario', run: a.openMocks },
    { id: 'go:library', group: '이동', label: '케이스 라이브러리 열기', keywords: 'case library', run: a.openLibrary },
    { id: 'go:contracts', group: '이동', label: '계약 테스트 열기', keywords: 'contract test', run: a.openContracts }
  );
  if (input.library.endpoints.length > 0) {
    out.push({
      id: 'go:new-scenario',
      group: '이동',
      label: '새 시나리오 만들기',
      keywords: 'new scenario',
      run: () => a.openScenario(null)
    });
  }

  out.push(
    input.proxyRunning
      ? { id: 'act:proxy-stop', group: '동작', label: '프록시 중지', keywords: 'proxy stop', run: a.stopProxy }
      : { id: 'act:proxy-start', group: '동작', label: '프록시 시작', keywords: 'proxy start', run: a.startProxy },
    input.mode === 'mock'
      ? {
          id: 'act:mode',
          group: '동작',
          label: '캡처 모드로 전환',
          keywords: 'capture mode',
          run: () => a.setMode('capture')
        }
      : {
          id: 'act:mode',
          group: '동작',
          label: '목킹 모드로 전환',
          keywords: 'mock mode',
          run: () => a.setMode('mock')
        },
    { id: 'act:clear', group: '동작', label: '캡처 지우기', keywords: 'clear capture', run: a.clearCapture }
  );
  if (input.activeTabKey) {
    out.push({
      id: 'act:close-tab',
      group: '동작',
      label: '현재 탭 닫기',
      keywords: 'close tab',
      run: a.closeActiveTab
    });
  }

  for (const m of input.mocks) {
    out.push({
      id: `mock:${m.id}`,
      group: '목',
      label: `${m.method} ${m.path}`,
      hint: m.enabled ? undefined : '꺼짐',
      run: a.openMocks
    });
  }

  for (const s of input.scenarios) {
    out.push({
      id: `scenario-activate:${s.name}`,
      group: '시나리오',
      label: `시나리오 활성화: ${s.name}`,
      keywords: s.name,
      hint: s.name === input.activeScenario ? '활성' : undefined,
      run: () => a.activateScenario(s.name)
    });
    out.push({
      id: `scenario-edit:${s.name}`,
      group: '시나리오',
      label: `시나리오 편집: ${s.name}`,
      keywords: s.name,
      run: () => a.openScenario(s.name)
    });
  }

  for (const c of input.contracts) {
    out.push({
      id: `contract:${c.name}`,
      group: '계약',
      label: c.name,
      keywords: c.endpointId,
      hint: c.endpointId,
      run: a.openContracts
    });
  }

  if (input.hasProject) {
    for (const name of input.captureSessions) {
      out.push({
        id: `session:${name}`,
        group: '세션',
        label: `세션 불러오기: ${name}`,
        keywords: name,
        run: () => a.loadSession(name)
      });
    }
  }

  for (const e of input.exchanges) {
    out.push({
      id: `ex:${e.id}`,
      group: '요청',
      label: `${e.request.method} ${e.request.path}`,
      keywords: e.request.url,
      hint: e.request.destination,
      run: () => a.openExchange(e.id)
    });
  }

  return out;
}

const MAX_RESULTS = 50;
/** 검색어가 없을 때는 요청 목록이 너무 길어서 빼 둔다(찾으려면 검색한다). */
const HIDDEN_WITHOUT_QUERY: CommandGroup[] = ['요청'];

/** 점수가 낮을수록 위. 라벨 앞부분 일치 < 단어 시작 일치 < 포함 일치. */
function score(text: string, token: string): number {
  const index = text.indexOf(token);
  if (index < 0) return Infinity;
  if (index === 0) return 0;
  return /[\s/:·-]/.test(text[index - 1]) ? 1 : 2;
}

/** 공백으로 나눈 모든 단어가 라벨/키워드에 들어 있는 항목만, 일치가 좋은 순으로(같으면 원래 순서) 돌려준다. */
export function filterCommands(commands: Command[], query: string): Command[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return commands.filter((c) => !HIDDEN_WITHOUT_QUERY.includes(c.group)).slice(0, MAX_RESULTS);
  }
  const scored: Array<{ command: Command; total: number; order: number }> = [];
  commands.forEach((command, order) => {
    const label = command.label.toLowerCase();
    const haystack = `${label} ${(command.keywords ?? '').toLowerCase()}`;
    let total = 0;
    for (const token of tokens) {
      const s = Math.min(score(label, token), score(haystack, token) + 1);
      if (s === Infinity) return;
      total += s;
    }
    scored.push({ command, total, order });
  });
  scored.sort((x, y) => x.total - y.total || x.order - y.order);
  return scored.slice(0, MAX_RESULTS).map((s) => s.command);
}
