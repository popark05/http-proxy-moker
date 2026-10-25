import { useEffect, useMemo, useState } from 'react';
import { Pencil, Play, Trash2 } from 'lucide-react';
import {
  contractOrigins,
  looksLikeProduction,
  requiredVariables,
  summarizeRun,
  type Contract,
  type ContractRunResult,
  type ContractRunStatus,
  type ContractServer
} from '@shared/contract';
import { Modal, methodTone } from '../primitives';
import { ContractEditor } from './ContractEditor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ContractModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contracts: Contract[];
  servers: ContractServer[];
  onRemoveContract: (name: string) => void;
  onUpdateContract: (contract: Contract) => void;
  onUpsertServer: (server: ContractServer) => Promise<boolean>;
  onRemoveServer: (name: string) => void;
}

const STATUS_LABEL: Record<ContractRunStatus, string> = {
  passed: '통과',
  failed: '실패',
  skipped: '건너뜀',
  error: '오류'
};
const STATUS_TONE: Record<ContractRunStatus, 'success' | 'error' | 'neutral' | 'warning'> = {
  passed: 'success',
  failed: 'error',
  skipped: 'neutral',
  error: 'warning'
};

/**
 * 계약 테스트: 저장된 계약을 골라 등록된 서버로 실행하고 결과를 본다.
 * 토큰 같은 변수는 실행할 때만 입력하며 어디에도 저장하지 않는다.
 */
export function ContractModal({
  open,
  onOpenChange,
  contracts,
  servers,
  onRemoveContract,
  onUpdateContract,
  onUpsertServer,
  onRemoveServer
}: ContractModalProps): JSX.Element {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  /** 캡처한 서버(origin) → 대신 보낼 등록 서버 이름. 없으면 캡처한 서버로 그대로 보낸다. */
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [vars, setVars] = useState<Record<string, string>>({});
  const [allowUnsafe, setAllowUnsafe] = useState(false);
  const [results, setResults] = useState<ContractRunResult[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [editing, setEditing] = useState<Contract | undefined>();
  const [newServer, setNewServer] = useState({ name: '', baseUrl: '' });

  // 열 때 선택이 없으면 전부 선택해 바로 실행할 수 있게 한다.
  useEffect(() => {
    if (open) setChecked((prev) => (prev.size === 0 ? new Set(contracts.map((c) => c.name)) : prev));
  }, [open, contracts]);
  // 사라진 계약은 선택에서 뺀다.
  useEffect(() => {
    setChecked((prev) => {
      const names = new Set(contracts.map((c) => c.name));
      const next = new Set([...prev].filter((n) => names.has(n)));
      return next.size === prev.size ? prev : next;
    });
  }, [contracts]);

  const selected = useMemo(() => contracts.filter((c) => checked.has(c.name)), [contracts, checked]);
  const variables = useMemo(() => requiredVariables(selected), [selected]);
  const origins = useMemo(() => contractOrigins(selected), [selected]);
  const noOrigin = selected.some((c) => !c.source?.origin);
  /** 실제로 요청이 가는 서버 주소(등록 서버로 바꿨으면 그 주소). */
  const effectiveTarget = (origin: string): ContractServer => {
    const server = servers.find((s) => s.name === targets[origin]);
    return server ?? { name: origin, baseUrl: origin };
  };
  const summary = summarizeRun(results);

  const run = async (): Promise<void> => {
    if (selected.length === 0) return;
    const risky = origins.map(effectiveTarget).filter(looksLikeProduction);
    if (risky.length > 0 && !window.confirm(`${risky.map((s) => s.baseUrl).join(', ')}은(는) 운영 서버로 보입니다. 정말 실행할까요?`)) {
      return;
    }
    if (allowUnsafe && selected.some((c) => !c.safeToRun)) {
      if (!window.confirm('GET이 아닌 요청이 실제 서버로 전송됩니다(데이터가 바뀔 수 있음). 계속할까요?')) return;
    }
    setRunning(true);
    setError(undefined);
    setResults([]);
    const off = window.mokerApi.contract.onResult((r) => setResults((prev) => [...prev, r]));
    try {
      const hostMap: Record<string, string> = {};
      for (const origin of origins) {
        const server = servers.find((s) => s.name === targets[origin]);
        if (server) hostMap[origin] = server.baseUrl;
      }
      const all = await window.mokerApi.contract.run(selected, { hostMap, vars, allowUnsafe });
      setResults(all); // 입력 순서로 정렬된 최종 결과
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      off();
      setRunning(false);
    }
  };

  const addServer = async (): Promise<void> => {
    if (await onUpsertServer(newServer)) {
      setNewServer({ name: '', baseUrl: '' });
      setError(undefined);
    } else {
      setError('서버 이름과 http(s):// 주소를 확인하세요.');
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="계약 테스트" className="w-[94vw] max-w-none sm:max-w-4xl">
      <div className="flex max-h-[70vh] flex-col gap-3 overflow-auto text-sm">
        {/* 1. 서버: 캡처한 서버가 기본, 필요하면 등록한 서버로 바꾼다 */}
        <section className="rounded-md border border-border p-3">
          <h3 className="mb-1 font-medium">보낼 서버</h3>
          <p className="mb-2 text-xs text-muted-foreground">
            기본은 캡처한 서버로 그대로 보냅니다. 개발/스테이징 서버로 보내려면 아래에서 등록한 서버를 고르세요.
          </p>
          {origins.length === 0 && !noOrigin && <p className="text-xs text-muted-foreground">계약을 선택하세요.</p>}
          <div className="flex flex-col gap-1.5">
            {origins.map((origin) => (
              <div key={origin} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono" title={origin}>{origin}</span>
                <span className="text-muted-foreground">→</span>
                <select
                  aria-label={`${origin} 보낼 서버`}
                  className="h-8 max-w-64 rounded-md border border-input bg-transparent px-2"
                  value={targets[origin] ?? ''}
                  onChange={(e) => setTargets({ ...targets, [origin]: e.target.value })}
                >
                  <option value="">캡처한 서버 그대로</option>
                  {servers.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name} — {s.baseUrl}
                    </option>
                  ))}
                </select>
                {looksLikeProduction(effectiveTarget(origin)) && <Badge variant="warning">운영 서버로 보임</Badge>}
              </div>
            ))}
            {noOrigin && (
              <p className="text-xs text-destructive">
                캡처 출처가 없는 계약이 있어 건너뜁니다(다시 캡처해 저장하세요).
              </p>
            )}
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              대체 서버 등록·관리 ({servers.length})
            </summary>
            <ul className="mt-1">
              {servers.map((s) => (
                <li key={s.name} className="flex items-center gap-2 text-xs">
                  <span className="font-medium">{s.name}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{s.baseUrl}</span>
                  <Button variant="ghost" size="sm" aria-label={`${s.name} 서버 삭제`} onClick={() => onRemoveServer(s.name)}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
            <div className="mt-1 flex flex-wrap gap-2">
              <Input aria-label="새 서버 이름" className="h-8 w-32" placeholder="이름(dev)" value={newServer.name} onChange={(e) => setNewServer({ ...newServer, name: e.target.value })} />
              <Input aria-label="새 서버 주소" className="h-8 min-w-48 flex-1" placeholder="https://dev.example.com" value={newServer.baseUrl} onChange={(e) => setNewServer({ ...newServer, baseUrl: e.target.value })} />
              <Button variant="outline" size="sm" onClick={() => void addServer()}>
                서버 등록
              </Button>
            </div>
          </details>
        </section>

        {/* 2. 계약 선택 */}
        <section className="rounded-md border border-border">
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                aria-label="계약 전체 선택"
                checked={contracts.length > 0 && checked.size === contracts.length}
                onChange={(e) => setChecked(e.target.checked ? new Set(contracts.map((c) => c.name)) : new Set())}
                className="size-4 accent-[hsl(var(--primary))]"
              />
              계약 {contracts.length}개 · {checked.size}개 선택
            </label>
          </div>
          {contracts.length === 0 ? (
            <p className="p-4 text-center text-muted-foreground">
              저장된 계약이 없습니다. 트래픽 목록에서 요청을 선택해 &quot;계약으로 저장&quot;을 누르세요.
            </p>
          ) : (
            <ul className="max-h-48 overflow-auto">
              {contracts.map((c) => (
                <li key={c.name} className="flex items-center gap-2 border-b border-border px-3 py-1 last:border-b-0">
                  <input
                    type="checkbox"
                    aria-label={`${c.name} 선택`}
                    checked={checked.has(c.name)}
                    onChange={(e) =>
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(c.name);
                        else next.delete(c.name);
                        return next;
                      })
                    }
                    className="size-4 accent-[hsl(var(--primary))]"
                  />
                  <Badge variant={methodTone(c.request.method)}>{c.request.method}</Badge>
                  <span className="min-w-0 flex-1 truncate font-mono" title={c.name}>
                    {c.endpointId.replace(/^\S+ /, '')}
                  </span>
                  {!c.verifiable && <Badge variant="neutral">검증 제외</Badge>}
                  {!c.safeToRun && <Badge variant="warning">변경 요청</Badge>}
                  <Button variant="ghost" size="sm" aria-label={`${c.name} 편집`} onClick={() => setEditing(c)}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={`${c.name} 삭제`} onClick={() => onRemoveContract(c.name)}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 3. 변수 + 옵션 */}
        {(variables.length > 0 || selected.some((c) => !c.safeToRun)) && (
          <section className="rounded-md border border-border p-3">
            {variables.length > 0 && (
              <>
                <h3 className="mb-1 font-medium">변수 (저장되지 않음)</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {variables.map((v) => (
                    <label key={v} className="flex items-center gap-2">
                      <span className="w-32 shrink-0 truncate font-mono text-xs" title={v}>{v}</span>
                      <Input
                        aria-label={`변수 ${v}`}
                        type="password"
                        autoComplete="off"
                        className="h-8"
                        value={vars[v] ?? ''}
                        onChange={(e) => setVars({ ...vars, [v]: e.target.value })}
                      />
                    </label>
                  ))}
                </div>
              </>
            )}
            {selected.some((c) => !c.safeToRun) && (
              <label className="mt-2 flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={allowUnsafe} onChange={(e) => setAllowUnsafe(e.target.checked)} className="size-4" />
                GET이 아닌 요청도 실행(데이터가 바뀔 수 있음)
              </label>
            )}
          </section>
        )}

        <div className="flex items-center gap-2">
          <Button disabled={running || selected.length === 0} onClick={() => void run()}>
            <Play /> {running ? '실행 중…' : `${selected.length}개 실행`}
          </Button>
          {results.length > 0 && (
            <span className="text-xs text-muted-foreground">
              통과 {summary.passed} · 실패 {summary.failed} · 오류 {summary.error} · 건너뜀 {summary.skipped}
            </span>
          )}
          {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
        </div>

        {/* 4. 결과 */}
        {results.length > 0 && (
          <section aria-label="실행 결과" className="rounded-md border border-border">
            {results.map((r) => (
              <details key={r.contractName} className="border-b border-border px-3 py-1.5 last:border-b-0" open={r.status === 'failed' || r.status === 'error'}>
                <summary className="flex cursor-pointer items-center gap-2">
                  <Badge variant={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  <span className="min-w-0 flex-1 truncate font-mono">{r.endpointId}</span>
                  {r.httpStatus !== undefined && <span className="text-xs text-muted-foreground">{r.httpStatus}</span>}
                  {r.durationMs !== undefined && <span className="text-xs text-muted-foreground">{r.durationMs}ms</span>}
                </summary>
                <div className="mt-1 pl-1 text-xs">
                  {r.reason && <p className="text-muted-foreground">{r.reason}</p>}
                  {r.violations.map((v, i) => (
                    <p key={i} className="font-mono">
                      <span className="text-destructive">{v.path}</span> {v.message}
                    </p>
                  ))}
                  {!r.reason && r.violations.length === 0 && <p className="text-muted-foreground">기대와 일치합니다.</p>}
                </div>
              </details>
            ))}
          </section>
        )}
      </div>
      <ContractEditor contract={editing} onClose={() => setEditing(undefined)} onSave={onUpdateContract} />
    </Modal>
  );
}
