import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { MockDefinition } from '../../src/shared/mock';
import {
  EMPTY_LIBRARY,
  scenarioFromWorkspace,
  upsertCase,
  type ScenarioV2
} from '../../src/shared/scenario-library';

vi.mock('../../src/renderer/src/components/code/CodeView', () => ({
  CodeView: ({ value }: { value: string }) => <pre data-testid="code">{value}</pre>
}));
vi.mock('../../src/renderer/src/components/code/CodeDiffView', () => ({ CodeDiffView: () => <div /> }));

import { ScenarioPanel } from '../../src/renderer/src/components/mock/ScenarioPanel';
import { ScenarioEditor } from '../../src/renderer/src/components/mock/ScenarioEditor';
import { isDisabled } from './disabled-helper';
import { chooseOption, openSelector, selectorOf } from './selector-helper';

const mock = (method: string, path: string, status = 200, body = '{}'): MockDefinition => ({
  id: `m${method}${path}${status}`,
  label: `${method} ${path}`,
  method,
  host: '',
  path,
  enabled: true,
  response: { status, headers: [], body }
});

function fixture() {
  const base = scenarioFromWorkspace([mock('GET', '/feed'), mock('POST', '/pay')], EMPTY_LIBRARY, { id: 'b', name: '정상' });
  const failCase = upsertCase(base.library, mock('POST', '/pay', 500, '{"e":1}'));
  return { library: failCase.library, base: base.scenario, failCaseId: failCase.caseId };
}

describe('ScenarioPanel', () => {
  const noop = () => {};
  const props = { hasLibrary: true, onEdit: noop, onDelete: noop, onUpdateActive: noop, onNew: noop };

  it('활성 시나리오가 수정되면 "수정됨"과 되돌리기/현재 작업 반영 버튼을 보여준다', () => {
    const { base } = fixture();
    const onUpdate = vi.fn();
    const onActivate = vi.fn();
    render(
      <ScenarioPanel
        {...props}
        onUpdateActive={onUpdate}
        onActivate={onActivate}
        scenarios={[{ ...base, description: '기본 흐름', tags: ['결제'] }]}
        activeScenario="정상"
        diff={{ dirty: true, changed: ['POST /pay'], added: [], removed: [] }}
      />
    );
    expect(screen.getByText(/수정됨 1/)).toBeTruthy();
    expect(screen.getByText('기본 흐름')).toBeTruthy();
    fireEvent.click(screen.getByText('현재 작업 반영'));
    expect(onUpdate).toHaveBeenCalled();
    fireEvent.click(screen.getByText('되돌리기'));
    expect(onActivate).toHaveBeenCalledWith('정상');
  });

  it('상속 표시와 비활성 시나리오의 활성화 버튼, 라이브러리가 비면 새 시나리오 비활성', () => {
    const { base } = fixture();
    const child: ScenarioV2 = { version: 2, id: 'c', name: '결제 실패', base: '정상', picks: [] };
    const onActivate = vi.fn();
    render(<ScenarioPanel {...props} hasLibrary={false} onActivate={onActivate} scenarios={[base, child]} activeScenario={undefined} diff={undefined} />);
    expect(screen.getByText('정상', { selector: 'span.inline-flex' })).toBeTruthy(); // 상속 표시
    fireEvent.click(screen.getAllByText('활성화')[1]);
    expect(onActivate).toHaveBeenCalledWith('결제 실패');
    expect(isDisabled(screen.getByText('새 시나리오'))).toBe(true);
  });
});

/** 행의 "⋯" 메뉴를 열고 항목 이름으로 고른다. */
const openCaseMenu = (endpointId: string): void => {
  fireEvent.click(screen.getByLabelText(`${endpointId} 케이스 메뉴`));
};
const pickMenu = (endpointId: string, name: string | RegExp): void => {
  openCaseMenu(endpointId);
  fireEvent.click(screen.getByRole('menuitem', { name }));
};

describe('ScenarioEditor', () => {
  it('베이스를 상속하고 일부만 덮어쓴 변형 시나리오를 저장한다', () => {
    const { library, base, failCaseId } = fixture();
    const onSave = vi.fn();
    render(<ScenarioEditor open onOpenChange={() => {}} scenario={undefined} scenarios={[base]} library={library} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '결제 실패' } });
    chooseOption('베이스', '정상');
    // 상속된 선택이 기본 옵션으로 보인다.
    expect(screen.getAllByText(/상속: 200/).length).toBeGreaterThan(0);
    const failName = library.endpoints.find((e) => e.id === 'POST /pay')!.cases.find((c) => c.id === failCaseId)!.name;
    pickMenu('POST /pay', failName);
    // /feed는 상속 끄기
    pickMenu('GET /feed', '사용 안 함 (상속 끄기)');
    fireEvent.click(screen.getByText('저장'));
    const saved = onSave.mock.calls[0][0] as ScenarioV2;
    expect(saved.name).toBe('결제 실패');
    expect(saved.base).toBe('정상');
    expect(saved.picks).toEqual(
      expect.arrayContaining([
        { endpointId: 'POST /pay', caseId: failCaseId },
        { endpointId: 'GET /feed', caseId: null }
      ])
    );
  });

  it('이름이 비었거나 중복이면 저장하지 않고 안내한다', () => {
    const { library, base } = fixture();
    const onSave = vi.fn();
    render(<ScenarioEditor open onOpenChange={() => {}} scenario={undefined} scenarios={[base]} library={library} onSave={onSave} />);
    fireEvent.click(screen.getByText('저장'));
    expect(screen.getByText(/이름을 입력/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '정상' } });
    fireEvent.click(screen.getByText('저장'));
    expect(screen.getByText(/이미 있습니다/)).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('베이스 후보에서 자기 자신과 자신을 상속한 시나리오는 빠진다(순환 방지)', () => {
    const { library, base } = fixture();
    const child: ScenarioV2 = { version: 2, id: 'c', name: '자식', base: '정상', picks: [] };
    render(<ScenarioEditor open onOpenChange={() => {}} scenario={base} scenarios={[base, child]} library={library} onSave={() => {}} />);
    const options = openSelector('베이스');
    expect(options).toEqual(['없음 (독립 시나리오)']);
  });
});

describe('ScenarioEditor 편집 대상 전환', () => {
  beforeEach(() => {
    window.confirm = vi.fn(() => true);
  });

  it('편집 대상 목록으로 다른 시나리오로 옮기고, 활성 여부를 보여 준다', () => {
    const { library, base } = fixture();
    const other: ScenarioV2 = { version: 2, id: 'o', name: '앱초기화', picks: [] };
    const onSwitch = vi.fn();
    const onActivate = vi.fn();
    render(
      <ScenarioEditor
        open
        onOpenChange={() => {}}
        scenario={other}
        scenarios={[base, other]}
        library={library}
        onSave={() => {}}
        activeScenario="정상"
        onSwitch={onSwitch}
        onActivate={onActivate}
      />
    );
    expect(screen.getByText('지금 활성: 정상')).toBeTruthy();
    fireEvent.click(screen.getByText('이 시나리오 활성화'));
    expect(onActivate).toHaveBeenCalledWith('앱초기화');
    chooseOption('편집 대상', '정상');
    expect(onSwitch).toHaveBeenCalledWith('정상');
    // 변경이 없으면 확인창 없이 옮긴다.
    expect(window.confirm).not.toHaveBeenCalled();
    chooseOption('편집 대상', '+ 새 시나리오');
    expect(onSwitch).toHaveBeenCalledWith(null);
  });

  it('저장하지 않은 변경이 있으면 확인하고, 거절하면 옮기지 않는다', () => {
    const { library, base } = fixture();
    const other: ScenarioV2 = { version: 2, id: 'o', name: '앱초기화', picks: [] };
    window.confirm = vi.fn(() => false);
    const onSwitch = vi.fn();
    render(
      <ScenarioEditor open onOpenChange={() => {}} scenario={other} scenarios={[base, other]} library={library} onSave={() => {}} onSwitch={onSwitch} />
    );
    fireEvent.change(screen.getByLabelText('설명'), { target: { value: '바꿈' } });
    chooseOption('편집 대상', '정상');
    expect(window.confirm).toHaveBeenCalled();
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('활성 시나리오를 편집 중이면 "활성" 배지를 보여 준다', () => {
    const { library, base } = fixture();
    render(<ScenarioEditor open onOpenChange={() => {}} scenario={base} scenarios={[base]} library={library} onSave={() => {}} activeScenario="정상" onSwitch={() => {}} onActivate={() => {}} />);
    expect(screen.getByText('활성')).toBeTruthy();
    expect(screen.queryByText('이 시나리오 활성화')).toBeNull();
  });
});

describe('ScenarioEditor 응답 케이스 통합', () => {
  beforeEach(() => {
    window.confirm = vi.fn(() => true);
  });

  const renderEditor = (onCommitLibrary = vi.fn(), scenarios?: ScenarioV2[]) => {
    const { library, base } = fixture();
    render(
      <ScenarioEditor
        open
        onOpenChange={() => {}}
        scenario={base}
        scenarios={scenarios ?? [base]}
        library={library}
        onSave={() => {}}
        onCommitLibrary={onCommitLibrary}
      />
    );
    return { onCommitLibrary, base };
  };

  it('엣지케이스 프리셋을 추가하면 라이브러리를 커밋하고 그 케이스를 이 행의 선택으로 지정한다', () => {
    const { library, base } = fixture();
    const onCommitLibrary = vi.fn();
    const ui = (lib: typeof library) => (
      <ScenarioEditor open onOpenChange={() => {}} scenario={base} scenarios={[base]} library={lib} onSave={() => {}} onCommitLibrary={onCommitLibrary} />
    );
    const { rerender } = render(ui(library));
    pickMenu('GET /feed', '추가: 500 서버 오류');
    const committed = onCommitLibrary.mock.calls[0][0].library;
    const endpoint = committed.endpoints.find((e: { id: string }) => e.id === 'GET /feed');
    expect(endpoint.cases.map((c: { name: string }) => c.name)).toContain('500 서버 오류');
    // 앱에서는 커밋 뒤 라이브러리가 갱신되어 내려온다.
    rerender(ui(committed));
    const picked = endpoint.cases.find((c: { name: string }) => c.name === '500 서버 오류').id;
    expect(picked).toBeTruthy();
    // 새 케이스가 이 행의 선택으로 표시된다(이름 + 상태 배지).
    expect(screen.getByText('500 서버 오류')).toBeTruthy();
  });

  it('선택된 케이스를 삭제하면 사용처를 확인하고, 영향받은 시나리오와 함께 커밋하며 선택을 비운다', () => {
    const { onCommitLibrary, base } = renderEditor();
    pickMenu('GET /feed', '선택한 케이스 삭제');
    expect((window.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('정상');
    const next = onCommitLibrary.mock.calls[0][0];
    expect(next.scenarios[0].picks.length).toBeLessThan(base.picks.length);
    expect(screen.getByText('선택 안 함')).toBeTruthy();
  });

  it('선택된 케이스가 없으면 편집·삭제가 비활성이다', () => {
    const { library } = fixture();
    const empty: ScenarioV2 = { version: 2, id: 'e', name: '빈것', picks: [] };
    render(<ScenarioEditor open onOpenChange={() => {}} scenario={empty} scenarios={[empty]} library={library} onSave={() => {}} onCommitLibrary={() => {}} />);
    openCaseMenu('GET /feed');
    expect((screen.getByRole('menuitem', { name: '선택한 케이스 편집' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('menuitem', { name: '선택한 케이스 삭제' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('선택된 케이스를 편집하면 이름/응답이 갱신된 라이브러리를 커밋한다', () => {
    const { onCommitLibrary } = renderEditor();
    pickMenu('GET /feed', '선택한 케이스 편집');
    fireEvent.change(screen.getByLabelText('케이스 이름'), { target: { value: '정상 응답' } });
    // 엔드포인트는 고정(경로 입력이 비활성)
    expect(isDisabled(screen.getByLabelText('경로'))).toBe(true);
    fireEvent.click(screen.getAllByText('저장').at(-1)!);
    const names = onCommitLibrary.mock.calls[0][0].library.endpoints.flatMap((e: { cases: Array<{ name: string }> }) => e.cases.map((c) => c.name));
    expect(names).toContain('정상 응답');
  });

  it('케이스를 고치는 동안 입력 중인 설명은 유지된다', () => {
    const { library, base } = fixture();
    const onCommitLibrary = vi.fn();
    const { rerender } = render(
      <ScenarioEditor open onOpenChange={() => {}} scenario={base} scenarios={[base]} library={library} onSave={() => {}} onCommitLibrary={onCommitLibrary} />
    );
    fireEvent.change(screen.getByLabelText('설명'), { target: { value: '작성 중' } });
    // 케이스 삭제 등으로 시나리오 객체만 새로 만들어져도(대상은 같음) 입력은 초기화되지 않는다.
    rerender(
      <ScenarioEditor open onOpenChange={() => {}} scenario={{ ...base }} scenarios={[{ ...base }]} library={library} onSave={() => {}} onCommitLibrary={onCommitLibrary} />
    );
    expect((screen.getByLabelText('설명') as HTMLInputElement).value).toBe('작성 중');
  });

  it('onCommitLibrary가 없으면 케이스 편집 컨트롤을 그리지 않는다', () => {
    const { library, base } = fixture();
    render(<ScenarioEditor open onOpenChange={() => {}} scenario={base} scenarios={[base]} library={library} onSave={() => {}} />);
    openCaseMenu('GET /feed');
    expect(screen.queryByRole('menuitem', { name: /추가:/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: '선택한 케이스 편집' })).toBeNull();
  });
});

describe('탭 표시(variant="tab")', () => {
  it('ScenarioEditor는 대화상자 없이 본문을 그리고, 취소하면 닫기를 요청한다', () => {
    const { library, base } = fixture();
    const onOpenChange = vi.fn();
    const onSave = vi.fn();
    render(<ScenarioEditor variant="tab" open onOpenChange={onOpenChange} scenario={undefined} scenarios={[base]} library={library} onSave={onSave} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: '새 시나리오' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '신규' } });
    fireEvent.click(screen.getByText('저장'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: '신규' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
