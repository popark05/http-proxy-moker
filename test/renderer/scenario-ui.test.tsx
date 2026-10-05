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
import { LibraryModal } from '../../src/renderer/src/components/mock/LibraryModal';

const mock = (method: string, path: string, status = 200, body = '{}'): MockDefinition => ({
  id: `m${method}${path}${status}`,
  label: `${method} ${path}`,
  method,
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
  const props = { hasLibrary: true, onEdit: noop, onDelete: noop, onUpdateActive: noop, onNew: noop, onOpenLibrary: noop };

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
    expect((screen.getByText('새 시나리오').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ScenarioEditor', () => {
  it('베이스를 상속하고 일부만 덮어쓴 변형 시나리오를 저장한다', () => {
    const { library, base, failCaseId } = fixture();
    const onSave = vi.fn();
    render(<ScenarioEditor open onOpenChange={() => {}} scenario={undefined} scenarios={[base]} library={library} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '결제 실패' } });
    fireEvent.change(screen.getByLabelText('베이스'), { target: { value: '정상' } });
    // 상속된 선택이 기본 옵션으로 보인다.
    const pay = screen.getByLabelText('POST /pay 케이스') as HTMLSelectElement;
    expect(within(pay).getByText(/상속: 200/)).toBeTruthy();
    fireEvent.change(pay, { target: { value: failCaseId } });
    // /feed는 상속 끄기
    fireEvent.change(screen.getByLabelText('GET /feed 케이스'), { target: { value: '__none__' } });
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
    const options = within(screen.getByLabelText('베이스')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['없음 (독립 시나리오)']);
  });
});

describe('LibraryModal', () => {
  beforeEach(() => {
    window.confirm = vi.fn(() => true);
  });

  it('케이스 사용처를 보여주고, 삭제하면 영향받는 시나리오 선택도 정리해 커밋한다', () => {
    const { library, base } = fixture();
    const onCommit = vi.fn();
    render(<LibraryModal open onOpenChange={() => {}} library={library} scenarios={[base]} onCommit={onCommit} />);
    expect(screen.getAllByText(/사용: 정상/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByLabelText(/삭제/)[0]);
    expect((window.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('정상');
    const next = onCommit.mock.calls[0][0];
    expect(next.scenarios[0].picks.length).toBeLessThan(base.picks.length);
  });

  it('엣지케이스 프리셋을 추가한다', () => {
    const { library } = fixture();
    const onCommit = vi.fn();
    render(<LibraryModal open onOpenChange={() => {}} library={library} scenarios={[]} onCommit={onCommit} />);
    fireEvent.change(screen.getByLabelText('GET /feed 프리셋 추가'), { target: { value: 'server-error' } });
    const committed = onCommit.mock.calls[0][0].library;
    const names = committed.endpoints.find((e: { id: string }) => e.id === 'GET /feed').cases.map((c: { name: string }) => c.name);
    expect(names).toContain('500 서버 오류');
  });

  it('케이스를 편집하면 이름/응답이 갱신된 라이브러리를 커밋한다', () => {
    const { library } = fixture();
    const onCommit = vi.fn();
    render(<LibraryModal open onOpenChange={() => {}} library={library} scenarios={[]} onCommit={onCommit} />);
    fireEvent.click(screen.getAllByLabelText(/편집/)[0]);
    fireEvent.change(screen.getByLabelText('케이스 이름'), { target: { value: '정상 응답' } });
    // 엔드포인트는 고정(method/path 입력이 비활성)
    expect((screen.getByLabelText('경로') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('저장'));
    const names = onCommit.mock.calls[0][0].library.endpoints.flatMap((e: { cases: Array<{ name: string }> }) => e.cases.map((c) => c.name));
    expect(names).toContain('정상 응답');
  });
});
