import { useEffect, useMemo, useState } from 'react';
import type { CaseLibrary, ScenarioV2 } from '@shared/scenario-library';
import { effectivePicks } from '@shared/scenario-library';
import { Modal, methodTone } from '../primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ScenarioEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 편집할 시나리오. 없으면 새로 만든다. */
  scenario: ScenarioV2 | undefined;
  scenarios: ScenarioV2[];
  library: CaseLibrary;
  onSave: (scenario: ScenarioV2) => void;
}

const selectClass =
  'h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

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
export function ScenarioEditor({ open, onOpenChange, scenario, scenarios, library, onSave }: ScenarioEditorProps): JSX.Element {
  const editing = !!scenario;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [base, setBase] = useState('');
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('');
  const [onlyPicked, setOnlyPicked] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    setName(scenario?.name ?? '');
    setDescription(scenario?.description ?? '');
    setTagsText((scenario?.tags ?? []).join(', '));
    setBase(scenario?.base ?? '');
    setSelection(Object.fromEntries((scenario?.picks ?? []).map((p) => [p.endpointId, p.caseId === null ? NONE : p.caseId])));
    setFilter('');
    setOnlyPicked(false);
    setError(undefined);
  }, [open, scenario]);

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
    <Modal open={open} onOpenChange={onOpenChange} title={editing ? '시나리오 편집' : '새 시나리오'} className="w-[94vw] max-w-none sm:max-w-3xl">
      <div className="mb-3 grid grid-cols-[90px_1fr] items-center gap-2">
        <Label htmlFor="sc-name" className="text-muted-foreground">이름</Label>
        <Input id="sc-name" value={name} disabled={editing} onChange={(e) => setName(e.target.value)} placeholder="예: 결제 실패" />
        <Label htmlFor="sc-desc" className="text-muted-foreground">설명</Label>
        <Input id="sc-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="이 시나리오가 재현하는 상황" />
        <Label htmlFor="sc-tags" className="text-muted-foreground">태그</Label>
        <Input id="sc-tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="쉼표로 구분 (예: 결제, 에러)" />
        <Label htmlFor="sc-base" className="text-muted-foreground">베이스</Label>
        <select id="sc-base" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={base} onChange={(e) => setBase(e.target.value)}>
          <option value="">없음 (독립 시나리오)</option>
          {baseCandidates.map((s) => (
            <option key={s.name} value={s.name}>{s.name}</option>
          ))}
        </select>
      </div>

      <div className="mb-1 flex items-center gap-2">
        <Input aria-label="엔드포인트 검색" className="h-8" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="엔드포인트 검색" />
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={onlyPicked} onChange={(e) => setOnlyPicked(e.target.checked)} className="accent-[hsl(var(--primary))]" />
          선택된 것만
        </label>
      </div>
      {base && (
        <p className="mb-1 text-xs text-muted-foreground">
          &quot;{base}&quot;를 상속합니다. 비워 두면 베이스 값을 그대로 쓰고, 선택하면 이 시나리오에서만 덮어씁니다.
        </p>
      )}

      <div className="max-h-[42vh] overflow-auto rounded-md border border-border">
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
            return (
              <div key={e.id} className="grid grid-cols-[1fr_190px] items-center gap-2 border-b border-border px-3 py-1.5 last:border-b-0">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge variant={methodTone(e.method)}>{e.method}</Badge>
                  <span className="truncate font-mono text-xs" title={e.path}>{e.path}</span>
                </div>
                <select aria-label={`${e.id} 케이스`} className={selectClass} value={own} onChange={(ev) => setSelection({ ...selection, [e.id]: ev.target.value })}>
                  <option value="">{inh ? `상속: ${caseName(e.id, inh.caseId)}` : '— 선택 안 함'}</option>
                  {base && <option value={NONE}>사용 안 함 (상속 끄기)</option>}
                  {e.cases.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            );
          })
        )}
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>취소</Button>
        <Button size="sm" onClick={save}>저장</Button>
      </div>
    </Modal>
  );
}
