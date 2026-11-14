import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Circle, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import type { MockDefinition } from '@shared/mock';
import {
  CASE_PRESETS,
  addPresetCase,
  caseUsers,
  effectivePicks,
  removeCase,
  updateCase,
  type CaseLibrary,
  type LibraryEndpoint,
  type MockCase,
  type ScenarioV2
} from '@shared/scenario-library';
import { Modal, methodTone, statusTone } from '../primitives';
import { useContextMenu, type MenuItem } from '../primitives/ContextMenu';
import { MockEditor } from './MockEditor';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Selector } from '@astryxdesign/core/Selector';
import { TextInput } from '@astryxdesign/core/TextInput';
import { cn } from '@/lib/utils';

interface ScenarioEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 편집할 시나리오. 없으면 새로 만든다. */
  scenario: ScenarioV2 | undefined;
  scenarios: ScenarioV2[];
  library: CaseLibrary;
  onSave: (scenario: ScenarioV2) => void;
  /** 'tab'이면 워크스페이스 탭 안에 그린다. */
  variant?: 'modal' | 'tab';
  /** 지금 활성화된 시나리오 이름(편집 대상과 같은지 보여 준다). */
  activeScenario?: string;
  /** 주어지면 편집 대상을 바꾸는 선택(null = 새 시나리오)을 보여 준다. */
  onSwitch?: (name: string | null) => void;
  /** 주어지면 편집 중인 시나리오를 활성화하는 버튼을 보여 준다. */
  onActivate?: (name: string) => void;
  /** 주어지면 각 엔드포인트 행에서 응답 케이스를 추가·편집·삭제할 수 있다(라이브러리와 영향받은 시나리오를 저장). */
  onCommitLibrary?: (next: { library: CaseLibrary; scenarios?: ScenarioV2[] }) => void;
}

/** 케이스 편집기(MockEditor)에 넘기기 위한 케이스 → 목 정의 변환. 이름은 label에 담는다. */
function caseAsMock(endpoint: LibraryEndpoint, c: MockCase): MockDefinition {
  return {
    id: c.id,
    label: c.name,
    method: endpoint.method,
    host: endpoint.host,
    path: endpoint.path,
    enabled: true,
    response: c.response,
    delayMs: c.delayMs,
    fault: c.fault,
    originalBody: c.response.body
  };
}

const NEW_VALUE = '__new__';
/** 베이스를 지정하지 않는 선택지의 값. */
const NO_BASE = '__no-base__';

/** 선택 값 인코딩: '' = 이 시나리오에서는 정하지 않음(상속/미사용), NONE = 끔(상속 끄기), 그 외 = 케이스 ID. */
const NONE = '__none__';


/** self를 (직간접으로) 베이스로 삼는 시나리오 이름들 — 베이스 후보에서 빼서 순환 상속을 막는다. */
function descendantsOf(self: string, scenarios: readonly ScenarioV2[]): Set<string> {
  const out = new Set<string>();
  for (const s of scenarios) {
    const seen = new Set<string>();
    let cur: ScenarioV2 | undefined = s;
    while (cur && !seen.has(cur.name)) {
      seen.add(cur.name);
      if (cur.base === self) {
        out.add(s.name);
        break;
      }
      cur = scenarios.find((x) => x.name === cur!.base);
    }
  }
  return out;
}

/** 시나리오 편집: 이름/설명/태그/베이스 + 엔드포인트별 케이스 선택(상속과 덮어쓰기를 구분해 표시). */
export function ScenarioEditor({ open, onOpenChange, scenario, scenarios, library, onSave, variant, activeScenario, onSwitch, onActivate, onCommitLibrary }: ScenarioEditorProps): React.JSX.Element {
  const editing = !!scenario;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [base, setBase] = useState('');
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('');
  const [onlyPicked, setOnlyPicked] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const menu = useContextMenu();
  const [editingCase, setEditingCase] = useState<{ endpoint: LibraryEndpoint; mockCase: MockCase } | undefined>(undefined);

  /** 편집을 시작한 시점의 입력값(저장 전 변경 여부 판단용). */
  const initialRef = useRef('');
  const snapshot = (): string => JSON.stringify([name, description, tagsText, base, selection]);

  useEffect(() => {
    if (!open) return;
    initialRef.current = JSON.stringify([
      scenario?.name ?? '',
      scenario?.description ?? '',
      (scenario?.tags ?? []).join(', '),
      scenario?.base ?? '',
      Object.fromEntries((scenario?.picks ?? []).map((p) => [p.endpointId, p.caseId === null ? NONE : p.caseId]))
    ]);
    setName(scenario?.name ?? '');
    setDescription(scenario?.description ?? '');
    setTagsText((scenario?.tags ?? []).join(', '));
    setBase(scenario?.base ?? '');
    setSelection(Object.fromEntries((scenario?.picks ?? []).map((p) => [p.endpointId, p.caseId === null ? NONE : p.caseId])));
    setFilter('');
    setOnlyPicked(false);
    setError(undefined);
    // 케이스를 고치거나 지울 때 scenario 객체가 바뀌어도 입력 중인 내용은 유지한다(대상이 바뀔 때만 다시 불러온다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scenario?.id, scenario?.name]);

  const baseCandidates = useMemo(() => {
    const blocked = scenario ? descendantsOf(scenario.name, scenarios) : new Set<string>();
    return scenarios.filter((s) => s.name !== scenario?.name && !blocked.has(s.name));
  }, [scenario, scenarios]);

  const inherited = useMemo(() => (base ? effectivePicks(base, scenarios).picks : new Map()), [base, scenarios]);

  const rows = library.endpoints.filter((e) => {
    if (onlyPicked && !(selection[e.id] || inherited.get(e.id))) return false;
    return !filter.trim() || e.id.toLowerCase().includes(filter.trim().toLowerCase());
  });

  const caseName = (endpointId: string, caseId: string | null | undefined): string => {
    if (caseId === null) return '사용 안 함';
    const c = library.endpoints.find((e) => e.id === endpointId)?.cases.find((x) => x.id === caseId);
    return c?.name ?? '(삭제된 케이스)';
  };

  const addPreset = (endpoint: LibraryEndpoint, presetKey: string): void => {
    if (!onCommitLibrary || !presetKey) return;
    const out = addPresetCase(library, endpoint.id, presetKey);
    onCommitLibrary({ library: out.library });
    // 방금 만든 엣지케이스를 이 시나리오의 선택으로 바로 지정한다.
    if (out.caseId) setSelection((prev) => ({ ...prev, [endpoint.id]: out.caseId! }));
  };

  const deleteCase = (endpoint: LibraryEndpoint, c: MockCase): void => {
    if (!onCommitLibrary) return;
    const users = caseUsers(scenarios, endpoint.id, c.id);
    const message = users.length
      ? `"${c.name}" 케이스를 삭제하면 시나리오 ${users.join(', ')}에서도 이 선택이 빠집니다. 삭제할까요?`
      : `"${c.name}" 케이스를 삭제할까요?`;
    if (!window.confirm(message)) return;
    const out = removeCase(library, scenarios, endpoint.id, c.id);
    onCommitLibrary({ library: out.library, scenarios: out.scenarios });
    setSelection((prev) => (prev[endpoint.id] === c.id ? { ...prev, [endpoint.id]: '' } : prev));
  };

  /** 행의 "⋯" 메뉴: 케이스 고르기 + (라이브러리 편집이 열려 있으면) 엣지케이스 추가·편집·삭제. */
  const caseMenu = (endpoint: LibraryEndpoint, own: string, inh: { caseId: string | null } | undefined): MenuItem[] => {
    const choose = (value: string) => () => setSelection((prev) => ({ ...prev, [endpoint.id]: value }));
    const selectedCase = endpoint.cases.find((c) => c.id === own);
    const items: MenuItem[] = [
      { label: inh ? `상속: ${caseName(endpoint.id, inh.caseId)}` : '선택 안 함', icon: own === '' ? Check : Circle, onSelect: choose('') }
    ];
    if (base) items.push({ label: '사용 안 함 (상속 끄기)', icon: own === NONE ? Check : Circle, onSelect: choose(NONE) });
    for (const c of endpoint.cases) items.push({ label: c.name, icon: c.id === own ? Check : Circle, onSelect: choose(c.id) });
    if (onCommitLibrary) {
      CASE_PRESETS.forEach((p, i) =>
        items.push({ label: `추가: ${p.label}`, icon: Plus, onSelect: () => addPreset(endpoint, p.key), separatorBefore: i === 0 })
      );
      items.push(
        {
          label: '선택한 케이스 편집',
          icon: Pencil,
          disabled: !selectedCase,
          separatorBefore: true,
          onSelect: () => selectedCase && setEditingCase({ endpoint, mockCase: selectedCase })
        },
        {
          label: '선택한 케이스 삭제',
          icon: Trash2,
          destructive: true,
          disabled: !selectedCase,
          onSelect: () => selectedCase && deleteCase(endpoint, selectedCase)
        }
      );
    }
    return items;
  };

  const save = (): void => {
    const trimmed = name.trim();
    if (!trimmed) return setError('시나리오 이름을 입력하세요.');
    if (!editing && scenarios.some((s) => s.name === trimmed)) return setError('같은 이름의 시나리오가 이미 있습니다.');
    const picks = Object.entries(selection)
      .filter(([, v]) => v !== '' && (v !== NONE || !!base)) // 베이스가 없으면 "끔"은 의미가 없으므로 저장하지 않는다
      .map(([endpointId, v]) => ({ endpointId, caseId: v === NONE ? null : v }));
    const tags = tagsText.split(',').map((t) => t.trim()).filter(Boolean);
    onSave({
      version: 2,
      id: scenario?.id ?? `sc-${Date.now().toString(36)}`,
      name: trimmed,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(tags.length ? { tags } : {}),
      ...(base ? { base } : {}),
      picks
    });
    onOpenChange(false);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} variant={variant} title={editing ? '시나리오 편집' : '새 시나리오'} width={768}>
      {onSwitch && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Selector
            label="편집 대상"
            value={scenario ? scenario.name : NEW_VALUE}
            options={[
              ...scenarios.map((s) => ({ value: s.name, label: `${s.name}${s.name === activeScenario ? ' (활성)' : ''}` })),
              { value: NEW_VALUE, label: '+ 새 시나리오' }
            ]}
            onChange={(v) => {
              const next = v === NEW_VALUE ? null : v;
              if (next === (scenario?.name ?? null)) return;
              if (snapshot() !== initialRef.current && !window.confirm('저장하지 않은 변경 사항이 있습니다. 버리고 이동할까요?')) return;
              onSwitch(next);
            }}
          />
          {scenario && scenario.name === activeScenario ? (
            <Badge variant="warning" label="활성" />
          ) : (
            scenario &&
            onActivate && (
              <Button
                label="이 시나리오 활성화"
                variant="secondary"
                size="sm"
                onClick={() => onActivate(scenario.name)}
              />
            )
          )}
          {activeScenario && scenario?.name !== activeScenario && (
            <span className="text-xs text-muted-foreground">지금 활성: {activeScenario}</span>
          )}
        </div>
      )}
      <FormLayout direction="horizontal-labels">
        <TextInput label="이름" value={name} isDisabled={editing} onChange={setName} placeholder="예: 결제 실패" />
        <TextInput label="설명" value={description} onChange={setDescription} placeholder="이 시나리오가 재현하는 상황" />
        <TextInput label="태그" value={tagsText} onChange={setTagsText} placeholder="쉼표로 구분 (예: 결제, 에러)" />
      </FormLayout>
      <div className="h-3" />
      {/* 상속은 자주 쓰지 않으므로 접어 둔다(이미 베이스가 있으면 펼쳐서 보여 준다). */}
      <details className="mb-3 text-sm" open={!!scenario?.base || undefined}>
        <summary className="cursor-pointer select-none text-xs text-muted-foreground">고급: 다른 시나리오를 베이스로 상속</summary>
        <div className="mt-2">
          <FormLayout direction="horizontal-labels">
            <Selector
              label="베이스"
              value={base || NO_BASE}
              options={[
                { value: NO_BASE, label: '없음 (독립 시나리오)' },
                ...baseCandidates.map((s) => ({ value: s.name, label: s.name }))
              ]}
              onChange={(v) => setBase(v === NO_BASE ? '' : v)}
            />
          </FormLayout>
        </div>
      </details>

      <div className="mb-1 flex items-center gap-2">
        <TextInput
          label="엔드포인트 검색"
          isLabelHidden
          size="sm"
          containerClassName="flex-1"
          value={filter}
          onChange={setFilter}
          placeholder="엔드포인트 검색"
        />
        <CheckboxInput label="선택된 것만" value={onlyPicked} onChange={setOnlyPicked} />
      </div>
      {base && (
        <p className="mb-1 text-xs text-muted-foreground">
          &quot;{base}&quot;를 상속합니다. 비워 두면 베이스 값을 그대로 쓰고, 선택하면 이 시나리오에서만 덮어씁니다.
        </p>
      )}

      <div className={cn(variant !== 'tab' && 'max-h-[42vh] overflow-auto', 'rounded-md border border-border')}>
        {library.endpoints.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">
            라이브러리가 비어 있습니다. 목 정의에서 &quot;케이스로 저장&quot;으로 케이스를 먼저 만드세요.
          </p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">조건에 맞는 엔드포인트가 없습니다.</p>
        ) : (
          rows.map((e) => {
            const own = selection[e.id] ?? '';
            const inh = inherited.get(e.id);
            const selectedCase = e.cases.find((c) => c.id === own);
            return (
              <div
                key={e.id}
                className="grid grid-cols-[1fr_200px_auto] items-center gap-2 border-b border-border px-3 py-1.5 last:border-b-0"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Badge variant={methodTone(e.method)} label={e.method} />
                  <span className="truncate font-mono text-xs" title={`${e.host}${e.path}`}>
                    {e.host && <span className="text-muted-foreground">{e.host}</span>}
                    {e.path}
                  </span>
                </div>
                <div className="flex min-w-0 items-center gap-1.5 text-xs">
                  {selectedCase ? (
                    <>
                      <span className="min-w-0 truncate" title={selectedCase.name}>{selectedCase.name}</span>
                      {selectedCase.fault ? (
                        <Badge variant="error" label={selectedCase.fault} />
                      ) : (
                        <Badge
                          variant={statusTone(selectedCase.response.status)}
                          label={selectedCase.response.status}
                        />
                      )}
                    </>
                  ) : (
                    <span className="truncate text-muted-foreground">
                      {own === NONE ? '사용 안 함' : inh ? `상속: ${caseName(e.id, inh.caseId)}` : '선택 안 함'}
                    </span>
                  )}
                </div>
                <IconButton
                  label={`${e.id} 케이스 메뉴`}
                  icon={<Icon icon={MoreHorizontal} />}
                  variant="ghost"
                  aria-haspopup="menu"
                  onClick={(ev) => {
                    const r = ev.currentTarget.getBoundingClientRect();
                    menu.open(
                      { clientX: r.right - 200, clientY: r.bottom + 4, preventDefault: () => {}, stopPropagation: () => {} },
                      caseMenu(e, own, inh)
                    );
                  }}
                />
              </div>
            );
          })
        )}
      </div>

      {onCommitLibrary && (
        <p className="mt-1 text-xs text-muted-foreground">
          케이스를 고치거나 지우면 그 케이스를 쓰는 다른 시나리오에도 반영됩니다. 케이스 변경은 바로 저장되고, 어떤 케이스를 쓸지는 아래 &quot;저장&quot;을 눌러야 반영됩니다.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button label="취소" variant="ghost" size="sm" onClick={() => onOpenChange(false)} />
        <Button label="저장" variant="primary" size="sm" onClick={save} />
      </div>
      {menu.element}
      {onCommitLibrary && (
        <MockEditor
          mock={editingCase ? caseAsMock(editingCase.endpoint, editingCase.mockCase) : undefined}
          open={!!editingCase}
          onOpenChange={(o) => {
            if (!o) setEditingCase(undefined);
          }}
          lockEndpoint
          nameLabel="케이스 이름"
          title="케이스 편집"
          onSave={(mock) => {
            if (!editingCase) return;
            onCommitLibrary({
              library: updateCase(library, editingCase.endpoint.id, editingCase.mockCase.id, {
                name: mock.label,
                response: mock.response,
                delayMs: mock.delayMs,
                fault: mock.fault
              })
            });
          }}
        />
      )}
    </Modal>
  );
}
