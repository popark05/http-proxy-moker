import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { MockDefinition } from '@shared/mock';
import {
  CASE_PRESETS,
  addPresetCase,
  caseUsers,
  removeCase,
  updateCase,
  type CaseLibrary,
  type LibraryEndpoint,
  type MockCase,
  type ScenarioV2
} from '@shared/scenario-library';
import { Modal, methodTone, statusTone } from '../primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MockEditor } from './MockEditor';

interface LibraryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  library: CaseLibrary;
  scenarios: ScenarioV2[];
  /** 라이브러리(와 삭제로 영향받은 시나리오)를 저장. */
  onCommit: (next: { library: CaseLibrary; scenarios?: ScenarioV2[] }) => void;
}

/** 편집기(MockEditor)에 넘기기 위한 케이스 → 목 정의 변환. 이름은 label에 담는다. */
function caseAsMock(endpoint: LibraryEndpoint, c: MockCase): MockDefinition {
  return {
    id: c.id,
    label: c.name,
    method: endpoint.method,
    path: endpoint.path,
    enabled: true,
    response: c.response,
    delayMs: c.delayMs,
    fault: c.fault,
    originalBody: c.response.body
  };
}

/**
 * 케이스 라이브러리 관리: 엔드포인트별 응답 케이스(정상/500/타임아웃...)를 보고, 고치고, 지우고,
 * 엣지케이스 프리셋을 추가한다. 케이스를 고치면 그것을 참조하는 모든 시나리오에 반영된다.
 */
export function LibraryModal({ open, onOpenChange, library, scenarios, onCommit }: LibraryModalProps): JSX.Element {
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<{ endpoint: LibraryEndpoint; mockCase: MockCase } | undefined>(undefined);

  const endpoints = library.endpoints.filter(
    (e) => !filter.trim() || e.id.toLowerCase().includes(filter.trim().toLowerCase())
  );

  const handleDelete = (endpoint: LibraryEndpoint, c: MockCase): void => {
    const users = caseUsers(scenarios, endpoint.id, c.id);
    const message = users.length
      ? `"${c.name}" 케이스를 삭제하면 시나리오 ${users.join(', ')}에서도 이 선택이 빠집니다. 삭제할까요?`
      : `"${c.name}" 케이스를 삭제할까요?`;
    if (!window.confirm(message)) return;
    const out = removeCase(library, scenarios, endpoint.id, c.id);
    onCommit({ library: out.library, scenarios: out.scenarios });
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="케이스 라이브러리" className="w-[94vw] max-w-none sm:max-w-3xl">
      <p className="mb-2 text-xs text-muted-foreground">
        엔드포인트마다 응답 케이스를 모아 두고 시나리오가 참조합니다. 케이스를 고치면 그것을 쓰는 모든 시나리오에 반영됩니다.
      </p>
      <Input aria-label="엔드포인트 검색" className="mb-2 h-8" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="엔드포인트 검색" />

      <div className="flex max-h-[55vh] flex-col gap-2 overflow-auto">
        {library.endpoints.length === 0 ? (
          <p className="rounded-md border border-border p-4 text-center text-sm text-muted-foreground">
            아직 케이스가 없습니다. 목 정의 행의 &quot;케이스로 저장&quot; 또는 &quot;시나리오 저장&quot;으로 만들어 보세요.
          </p>
        ) : (
          endpoints.map((endpoint) => (
            <div key={endpoint.id} className="rounded-md border border-border">
              <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
                <Badge variant={methodTone(endpoint.method)}>{endpoint.method}</Badge>
                <span className="min-w-0 flex-1 truncate font-mono text-sm" title={endpoint.path}>{endpoint.path}</span>
                <select
                  aria-label={`${endpoint.id} 프리셋 추가`}
                  className="h-7 rounded-md border border-input bg-transparent px-1.5 text-xs"
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    onCommit({ library: addPresetCase(library, endpoint.id, e.target.value).library });
                  }}
                >
                  <option value="">+ 엣지케이스 추가</option>
                  {CASE_PRESETS.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </select>
              </div>
              {endpoint.cases.map((c) => {
                const users = caseUsers(scenarios, endpoint.id, c.id);
                return (
                  <div key={c.id} className="flex items-center gap-2 border-b border-border px-3 py-1.5 last:border-b-0">
                    <span className="min-w-0 flex-1 truncate text-sm" title={c.name}>{c.name}</span>
                    {c.fault ? <Badge variant="error">{c.fault}</Badge> : <Badge variant={statusTone(c.response.status)}>{c.response.status}</Badge>}
                    {c.delayMs ? <Badge variant="warning">{c.delayMs}ms</Badge> : null}
                    {c.response.bodyEncoding === 'base64' && <Badge variant="neutral">이진</Badge>}
                    <span className="max-w-[160px] truncate text-xs text-muted-foreground" title={users.join(', ')}>
                      {users.length ? `사용: ${users.join(', ')}` : '미사용'}
                    </span>
                    <Button variant="ghost" size="icon" aria-label={`${c.name} 편집`} onClick={() => setEditing({ endpoint, mockCase: c })}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`${c.name} 삭제`} onClick={() => handleDelete(endpoint, c)}>
                      <Trash2 />
                    </Button>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Plus className="size-3" /> 케이스 이름은 엔드포인트 안에서 구분됩니다.
        </span>
        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>닫기</Button>
      </div>

      <MockEditor
        mock={editing ? caseAsMock(editing.endpoint, editing.mockCase) : undefined}
        open={!!editing}
        onOpenChange={(o) => {
          if (!o) setEditing(undefined);
        }}
        lockEndpoint
        nameLabel="케이스 이름"
        title="케이스 편집"
        onSave={(mock) => {
          if (!editing) return;
          onCommit({
            library: updateCase(library, editing.endpoint.id, editing.mockCase.id, {
              name: mock.label,
              response: mock.response,
              delayMs: mock.delayMs,
              fault: mock.fault
            })
          });
        }}
      />
    </Modal>
  );
}
