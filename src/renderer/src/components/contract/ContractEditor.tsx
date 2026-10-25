import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { listShapeFields, type Contract, type FieldRule } from '@shared/contract';
import { Modal } from '../primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ContractEditorProps {
  contract: Contract | undefined;
  onClose: () => void;
  onSave: (contract: Contract) => void;
}

type Mode = 'type' | 'equals' | 'ignore';

/**
 * 계약의 기대값 편집: 상태 코드, 필수 응답 헤더, 필드별 비교 방식(타입만 / 값 일치 / 무시).
 * 시간·ID·토큰처럼 매번 달라지는 필드는 "무시", 고정이어야 하는 값은 "값 일치"로 둔다.
 */
export function ContractEditor({ contract, onClose, onSave }: ContractEditorProps): JSX.Element {
  return (
    <Modal
      open={!!contract}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={contract ? `계약 편집 — ${contract.endpointId}` : '계약 편집'}
      className="w-[94vw] max-w-none sm:max-w-3xl"
    >
      {contract && <EditorBody key={contract.name} contract={contract} onClose={onClose} onSave={onSave} />}
    </Modal>
  );
}

function EditorBody({ contract, onClose, onSave }: { contract: Contract; onClose: () => void; onSave: (c: Contract) => void }): JSX.Element {
  const [status, setStatus] = useState(String(typeof contract.expect.status === 'number' ? contract.expect.status : contract.expect.status.min));
  const [headers, setHeaders] = useState(contract.expect.headers);
  const [rules, setRules] = useState<Record<string, FieldRule>>(contract.expect.fieldRules ?? {});
  /** 값 일치 입력 중인 JSON 문자열(검증 전). */
  const [valueText, setValueText] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(contract.expect.fieldRules ?? {}).flatMap(([k, r]) => (r.mode === 'equals' ? [[k, JSON.stringify(r.value)]] : []))
    )
  );
  const [error, setError] = useState<string | undefined>();
  const fields = useMemo(() => (contract.expect.bodyShape ? listShapeFields(contract.expect.bodyShape) : []), [contract]);

  const modeOf = (path: string): Mode => rules[path]?.mode ?? 'type';

  const setMode = (path: string, mode: Mode): void => {
    setRules((prev) => {
      const next = { ...prev };
      if (mode === 'type') delete next[path];
      else if (mode === 'ignore') next[path] = { mode: 'ignore' };
      else next[path] = { mode: 'equals', value: null };
      return next;
    });
    if (mode === 'equals') setValueText((prev) => ({ ...prev, [path]: prev[path] ?? '""' }));
  };

  const save = (): void => {
    const code = Number(status);
    if (!Number.isInteger(code) || code < 100 || code > 599) {
      setError('상태 코드는 100~599 사이 정수여야 합니다.');
      return;
    }
    const finalRules: Record<string, FieldRule> = {};
    for (const [path, rule] of Object.entries(rules)) {
      if (rule.mode === 'equals') {
        try {
          finalRules[path] = { mode: 'equals', value: JSON.parse(valueText[path] ?? '') };
        } catch {
          setError(`${path}: 값이 올바른 JSON이 아닙니다(문자열은 "따옴표"로 감싸세요).`);
          return;
        }
      } else {
        finalRules[path] = rule;
      }
    }
    const { fieldRules: _old, ...expectRest } = contract.expect;
    onSave({
      ...contract,
      expect: { ...expectRest, status: code, headers, ...(Object.keys(finalRules).length > 0 ? { fieldRules: finalRules } : {}) }
    });
    onClose();
  };

  return (
    <div className="flex max-h-[70vh] flex-col gap-3 overflow-auto text-sm">
      <label className="flex items-center gap-2">
        <span className="w-24 shrink-0">상태 코드</span>
        <Input aria-label="기대 상태 코드" className="h-8 w-24" value={status} onChange={(e) => setStatus(e.target.value)} />
      </label>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-24 shrink-0">필수 응답 헤더</span>
        {headers.length === 0 && <span className="text-xs text-muted-foreground">없음</span>}
        {headers.map((h) => (
          <span key={h} className="flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 font-mono text-xs">
            {h}
            <button type="button" aria-label={`${h} 헤더 제거`} onClick={() => setHeaders(headers.filter((x) => x !== h))}>
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>

      <section className="rounded-md border border-border">
        <h3 className="border-b border-border px-3 py-1.5 font-medium">응답 본문 필드</h3>
        {fields.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">JSON 본문이 없어 상태 코드와 헤더만 검증합니다.</p>
        ) : (
          <ul>
            {fields.map((f) => (
              <li key={f.path} className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1 last:border-b-0">
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={f.path}>{f.path}</span>
                <span className="text-xs text-muted-foreground">{f.type}{f.required ? '' : ' · 선택'}</span>
                <select
                  aria-label={`${f.path} 비교 방식`}
                  className="h-7 rounded-md border border-input bg-transparent px-1.5 text-xs"
                  value={modeOf(f.path)}
                  onChange={(e) => setMode(f.path, e.target.value as Mode)}
                >
                  <option value="type">타입만</option>
                  <option value="equals">값 일치</option>
                  <option value="ignore">무시</option>
                </select>
                {modeOf(f.path) === 'equals' && (
                  <Input
                    aria-label={`${f.path} 기대 값`}
                    className="h-7 w-40 font-mono text-xs"
                    value={valueText[f.path] ?? ''}
                    onChange={(e) => setValueText({ ...valueText, [f.path]: e.target.value })}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex items-center gap-2">
        <Button onClick={save}>저장</Button>
        <Button variant="ghost" onClick={onClose}>취소</Button>
        {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
      </div>
    </div>
  );
}
