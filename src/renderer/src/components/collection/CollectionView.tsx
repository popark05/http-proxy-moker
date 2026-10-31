import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FolderOpen,
  Plus,
  Save,
  Send,
  Server,
  Trash2,
  Upload
} from 'lucide-react';
import {
  looksLikeProduction,
  type Contract,
  type ContractServer,
  type SendOutcome
} from '@shared/contract';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { CodeView } from '../code/CodeView';
import { EmptyState } from '../common/EmptyState';
import { methodTone, useContextMenu } from '../primitives';
import {
  applyUrlText,
  groupByServer,
  headersToText,
  newRequest,
  textToHeaders,
  urlTextOf,
  variablesOf,
  withRequest
} from '../../lib/collection';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export interface CollectionViewProps {
  /** 컬렉션은 프로젝트의 contracts/ 폴더에 저장되므로 프로젝트가 있어야 한다. */
  projectOpen: boolean;
  projectName?: string;
  contracts: Contract[];
  servers: ContractServer[];
  onCreate: (contract: Contract) => Promise<string>;
  onSave: (contract: Contract) => Promise<void>;
  onRemove: (name: string) => void;
  /** Bruno에서 가져온 요청을 저장하고 {저장,합침} 개수를 돌려준다. */
  onImport: (contracts: Contract[]) => Promise<{ saved: number; merged: number }>;
  onUpsertServer: (server: ContractServer) => Promise<boolean>;
  onRemoveServer: (name: string) => void;
}

const statusTone = (status: number): 'success' | 'info' | 'warning' | 'error' =>
  status >= 500 ? 'error' : status >= 400 ? 'warning' : status >= 300 ? 'info' : 'success';

function prettyBody(outcome: Extract<SendOutcome, { ok: true }>): { text: string; language: string } {
  if (outcome.bodyEncoding === 'base64') return { text: outcome.body ? '(이진 데이터)' : '(본문이 너무 커서 표시하지 않음)', language: 'plaintext' };
  const type = outcome.headers.find(([n]) => n.toLowerCase() === 'content-type')?.[1] ?? '';
  try {
    return { text: JSON.stringify(JSON.parse(outcome.body), null, 2), language: 'json' };
  } catch {
    return { text: outcome.body, language: /html/i.test(type) ? 'html' : /xml/i.test(type) ? 'xml' : 'plaintext' };
  }
}

const formatSize = (bytes: number): string => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);

/**
 * 컬렉션: 저장한 요청을 서버별 폴더로 보고, 고치고, 실제 서버로 보내 응답을 확인한다. Bruno 컬렉션으로 가져오기/내보내기.
 * 토큰 같은 변수는 보낼 때만 입력하며 어디에도 저장하지 않는다.
 */
export function CollectionView({
  projectOpen,
  projectName,
  contracts,
  servers,
  onCreate,
  onSave,
  onRemove,
  onImport,
  onUpsertServer,
  onRemoveServer
}: CollectionViewProps): JSX.Element {
  const menu = useContextMenu();
  const [selected, setSelected] = useState<string | undefined>();
  const [draft, setDraft] = useState<Contract | undefined>();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [section, setSection] = useState<'headers' | 'body' | 'vars'>('headers');
  const [respTab, setRespTab] = useState<'body' | 'headers'>('body');
  const [target, setTarget] = useState('');
  const [vars, setVars] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<SendOutcome | undefined>();
  const [note, setNote] = useState<{ tone: 'info' | 'error'; text: string } | undefined>();
  const [newServer, setNewServer] = useState({ name: '', baseUrl: '' });

  const original = useMemo(() => contracts.find((c) => c.name === selected), [contracts, selected]);
  // 다른 요청을 고르거나 저장돼서 원본이 바뀌면 편집본을 원본으로 맞춘다.
  useEffect(() => {
    setDraft(original);
    setOutcome(undefined);
  }, [original]);
  // 사라진 요청 선택은 푼다.
  useEffect(() => {
    if (selected && !contracts.some((c) => c.name === selected)) setSelected(undefined);
  }, [contracts, selected]);

  const folders = useMemo(() => groupByServer(contracts), [contracts]);
  const dirty = !!draft && !!original && JSON.stringify(draft.request) !== JSON.stringify(original.request);
  const variables = useMemo(() => (draft ? variablesOf(draft) : []), [draft]);
  const registered = servers.find((s) => s.name === target);

  const setRequest = (patch: Partial<Contract['request']>): void =>
    setDraft((d) => (d ? withRequest(d, { ...d.request, ...patch }) : d));

  const send = async (): Promise<void> => {
    if (!draft) return;
    const origin = draft.source?.origin;
    const effective: ContractServer | undefined = registered ?? (origin ? { name: origin, baseUrl: origin } : undefined);
    if (effective && looksLikeProduction(effective) && !window.confirm(`${effective.baseUrl}은(는) 운영 서버로 보입니다. 정말 보낼까요?`)) return;
    if (!draft.safeToRun && !window.confirm(`${draft.request.method} 요청이 실제 서버로 전송됩니다(데이터가 바뀔 수 있음). 계속할까요?`)) return;
    setSending(true);
    setNote(undefined);
    try {
      const hostMap: Record<string, string> = origin && registered ? { [origin]: registered.baseUrl } : {};
      setOutcome(
        await window.mokerApi.contract.send(draft, {
          ...(registered ? { baseUrl: registered.baseUrl } : {}),
          hostMap,
          vars
        })
      );
    } catch (e) {
      setOutcome({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setSending(false);
    }
  };

  const save = async (): Promise<void> => {
    if (!draft) return;
    await onSave(draft);
    setNote({ tone: 'info', text: '저장했습니다.' });
  };

  const create = async (from?: Contract): Promise<void> => {
    const base = from
      ? { ...from, id: `ct-${Date.now().toString(36)}`, name: `${from.name} 복사` }
      : newRequest(contracts.map((c) => c.name), `ct-${Date.now().toString(36)}`);
    setSelected(await onCreate(base));
  };

  const importBruno = async (): Promise<void> => {
    setNote(undefined);
    try {
      const out = await window.mokerApi.contract.importBruno();
      if (!out) return;
      const { saved, merged } = await onImport(out.contracts);
      const skipped = out.notes.length > 0 ? ` · 건너뜀 ${out.notes.length}개` : '';
      setNote({ tone: 'info', text: `Bruno에서 가져옴: 새 요청 ${saved}개, 기존에 합침 ${merged}개${skipped}` });
    } catch (e) {
      setNote({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const exportBruno = async (): Promise<void> => {
    setNote(undefined);
    try {
      const out = await window.mokerApi.contract.exportBruno(projectName ?? 'EverMock', contracts, servers);
      if (out) setNote({ tone: 'info', text: `Bruno 컬렉션으로 내보냄(${contracts.length}개 요청): ${out.dir}` });
    } catch (e) {
      setNote({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const addServer = async (): Promise<void> => {
    if (await onUpsertServer(newServer)) setNewServer({ name: '', baseUrl: '' });
    else setNote({ tone: 'error', text: '서버 이름과 http(s):// 주소를 확인하세요.' });
  };

  if (!projectOpen) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="프로젝트를 열어야 컬렉션을 쓸 수 있습니다"
        description="컬렉션은 프로젝트 폴더에 저장됩니다. 상단의 새 프로젝트나 열기로 프로젝트를 먼저 선택하세요. Bruno 컬렉션을 가져와도 같은 곳에 저장됩니다."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 text-sm">
      {/* 왼쪽: 요청 트리 */}
      <aside aria-label="컬렉션 요청" className="flex w-72 shrink-0 flex-col border-r border-border">
        <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
          <span className="mr-auto px-1 text-2xs font-medium uppercase tracking-wider text-muted-foreground">컬렉션</span>
          <Button variant="ghost" size="icon" aria-label="새 요청" title="새 요청" onClick={() => void create()}>
            <Plus />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Bruno 가져오기" title="Bruno 컬렉션 가져오기" onClick={() => void importBruno()}>
            <Upload />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Bruno 내보내기" title="Bruno 컬렉션으로 내보내기" disabled={contracts.length === 0} onClick={() => void exportBruno()}>
            <Download />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {contracts.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">
              아직 요청이 없습니다. 트래픽 목록에서 요청을 우클릭해 &quot;컬렉션에 추가&quot;를 고르거나, 위의 + 로 새 요청을 만드세요.
            </p>
          ) : (
            folders.map((folder) => {
              const open = !collapsed.has(folder.origin);
              return (
                <div key={folder.origin || '(none)'}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (!next.delete(folder.origin)) next.add(folder.origin);
                        return next;
                      })
                    }
                    className="flex h-8 w-full items-center gap-1.5 border-b border-border bg-muted/40 px-2 text-left"
                  >
                    {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                    <span className="truncate font-mono text-xs font-medium" title={folder.origin || '서버 없음'}>
                      {folder.origin ? folder.origin.replace(/^https?:\/\//, '') : '서버 없음'}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">{folder.items.length}</span>
                  </button>
                  {open &&
                    folder.items.map((c) => (
                      <button
                        key={c.name}
                        type="button"
                        onClick={() => setSelected(c.name)}
                        onContextMenu={(e) =>
                          menu.open(e, [
                            { label: '보내기', icon: Send, onSelect: () => setSelected(c.name) },
                            { label: '복제', icon: Copy, onSelect: () => void create(c) },
                            { label: '삭제', icon: Trash2, destructive: true, onSelect: () => onRemove(c.name) }
                          ])
                        }
                        className={cn(
                          'flex h-8 w-full items-center gap-2 border-b border-border pl-6 pr-2 text-left transition-colors',
                          selected === c.name ? 'bg-accent' : 'hover:bg-accent/50'
                        )}
                      >
                        <Badge variant={methodTone(c.request.method)}>{c.request.method}</Badge>
                        <span className="truncate font-mono text-xs" title={c.name}>
                          {c.endpointId.replace(/^\S+ /, '') || c.name}
                        </span>
                      </button>
                    ))}
                </div>
              );
            })
          )}
        </div>

        <details className="border-t border-border px-2 py-1.5">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <Server className="size-3.5" /> 대체 서버 ({servers.length})
          </summary>
          <ul className="mt-1">
            {servers.map((s) => (
              <li key={s.name} className="flex items-center gap-1 text-xs">
                <span className="font-medium">{s.name}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{s.baseUrl}</span>
                <Button variant="ghost" size="icon" aria-label={`${s.name} 서버 삭제`} onClick={() => onRemoveServer(s.name)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-1 flex flex-col gap-1">
            <Input aria-label="새 서버 이름" className="h-8" placeholder="이름 (dev)" value={newServer.name} onChange={(e) => setNewServer({ ...newServer, name: e.target.value })} />
            <Input aria-label="새 서버 주소" className="h-8" placeholder="https://dev.example.com" value={newServer.baseUrl} onChange={(e) => setNewServer({ ...newServer, baseUrl: e.target.value })} />
            <Button variant="outline" size="sm" onClick={() => void addServer()}>
              서버 등록
            </Button>
          </div>
        </details>
      </aside>

      {/* 오른쪽: 요청 편집 + 응답 */}
      <section aria-label="요청 편집" className="flex min-w-0 flex-1 flex-col">
        {note && (
          <p role={note.tone === 'error' ? 'alert' : 'status'} className={cn('border-b border-border px-3 py-1.5 text-xs', note.tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
            {note.text}
          </p>
        )}
        {!draft ? (
          <EmptyState
            icon={Send}
            title="요청을 고르세요"
            description="왼쪽에서 요청을 고르면 여기서 고쳐서 실제 서버로 보내 응답을 볼 수 있습니다."
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
              <select
                aria-label="메서드"
                className="h-9 rounded-md border border-input bg-transparent px-2 font-mono text-sm"
                value={draft.request.method}
                onChange={(e) => setRequest({ method: e.target.value })}
              >
                {METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <Input
                aria-label="URL"
                className="h-9 min-w-64 flex-1 font-mono"
                value={urlTextOf(draft.request)}
                onChange={(e) => setDraft((d) => (d ? withRequest(d, applyUrlText(d.request, e.target.value)) : d))}
              />
              <select
                aria-label="보낼 서버"
                className="h-9 max-w-52 rounded-md border border-input bg-transparent px-2 text-sm"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">{draft.source?.origin ? `캡처한 서버 (${draft.source.origin.replace(/^https?:\/\//, '')})` : '서버를 고르세요'}</option>
                {servers.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name} — {s.baseUrl}
                  </option>
                ))}
              </select>
              <Button disabled={sending} onClick={() => void send()}>
                <Send /> {sending ? '보내는 중…' : '보내기'}
              </Button>
              <Button variant="outline" disabled={!dirty} onClick={() => void save()}>
                <Save /> 저장{dirty ? ' •' : ''}
              </Button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              {/* 요청 설정 */}
              <div className="flex shrink-0 flex-col border-b border-border">
                <div role="tablist" aria-label="요청 설정" className="flex gap-1 border-b border-border px-2 pt-1">
                  {(
                    [
                      ['headers', `헤더 (${draft.request.headers.length})`],
                      ['body', draft.request.body ? '본문 •' : '본문'],
                      ['vars', `변수 (${variables.length})`]
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      role="tab"
                      type="button"
                      aria-selected={section === id}
                      onClick={() => setSection(id)}
                      className={cn('rounded-t-md px-3 py-1 text-xs', section === id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="p-2">
                  {section === 'headers' && (
                    <textarea
                      aria-label="요청 헤더"
                      spellCheck={false}
                      rows={5}
                      placeholder="이름: 값 (한 줄에 하나)"
                      value={headersToText(draft.request.headers)}
                      onChange={(e) => setRequest({ headers: textToHeaders(e.target.value) })}
                      className="w-full resize-y rounded-md border border-input bg-transparent p-2 font-mono text-xs"
                    />
                  )}
                  {section === 'body' && (
                    <textarea
                      aria-label="요청 본문"
                      spellCheck={false}
                      rows={7}
                      placeholder="요청 본문 (비우면 보내지 않음)"
                      value={draft.request.body?.encoding === 'base64' ? '(이진 본문은 편집할 수 없습니다)' : (draft.request.body?.content ?? '')}
                      disabled={draft.request.body?.encoding === 'base64'}
                      onChange={(e) =>
                        setRequest({
                          body: e.target.value
                            ? { encoding: 'text', content: e.target.value, contentType: draft.request.body?.contentType }
                            : undefined
                        })
                      }
                      className="w-full resize-y rounded-md border border-input bg-transparent p-2 font-mono text-xs"
                    />
                  )}
                  {section === 'vars' &&
                    (variables.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        이 요청에는 입력할 변수가 없습니다. URL·헤더·본문에 {'{{이름}}'} 을 쓰면 여기서 값을 넣을 수 있습니다(저장되지 않음).
                      </p>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {variables.map((v) => (
                          <label key={v} className="flex items-center gap-2">
                            <span className="w-28 shrink-0 truncate font-mono text-xs" title={v}>
                              {v}
                            </span>
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
                    ))}
                </div>
              </div>

              {/* 응답 */}
              <div aria-label="응답" className="flex min-h-0 flex-1 flex-col">
                {!outcome ? (
                  <p className="p-4 text-xs text-muted-foreground">&quot;보내기&quot;를 누르면 응답이 여기에 표시됩니다.</p>
                ) : !outcome.ok ? (
                  <p role="alert" className="p-4 text-xs text-destructive">
                    {outcome.error}
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
                      <Badge variant={statusTone(outcome.status)}>
                        {outcome.status} {outcome.statusText}
                      </Badge>
                      <span className="text-muted-foreground">{outcome.durationMs} ms</span>
                      <span className="text-muted-foreground">{formatSize(outcome.sizeBytes)}</span>
                      {outcome.truncated && <Badge variant="warning">본문 일부만 표시</Badge>}
                      {outcome.omittedHeaders.length > 0 && (
                        <span className="text-muted-foreground" title="값이 없어 보내지 않은 헤더">
                          생략한 헤더: {outcome.omittedHeaders.join(', ')}
                        </span>
                      )}
                      <span className="ml-auto truncate font-mono text-muted-foreground" title={outcome.url}>
                        {outcome.url}
                      </span>
                    </div>
                    <div role="tablist" aria-label="응답 보기" className="flex gap-1 border-b border-border px-2 pt-1">
                      {(
                        [
                          ['body', '본문'],
                          ['headers', `헤더 (${outcome.headers.length})`]
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          role="tab"
                          type="button"
                          aria-selected={respTab === id}
                          onClick={() => setRespTab(id)}
                          className={cn('rounded-t-md px-3 py-1 text-xs', respTab === id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto">
                      {respTab === 'body' ? (
                        <CodeView value={prettyBody(outcome).text} language={prettyBody(outcome).language} readOnly height="100%" />
                      ) : (
                        <table className="w-full text-xs">
                          <tbody>
                            {outcome.headers.map(([n, v], i) => (
                              <tr key={i} className="border-b border-border">
                                <td className="w-48 px-3 py-1 font-mono font-medium">{n}</td>
                                <td className="break-all px-3 py-1 font-mono text-muted-foreground">{v}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </section>
      {menu.element}
    </div>
  );
}
