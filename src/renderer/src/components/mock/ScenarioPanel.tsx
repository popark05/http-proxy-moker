import { CheckCircle2, GitBranch, Layers, Library, Pencil, Play, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import type { ScenarioV2, WorkspaceDiff } from '@shared/scenario-library';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '../common/EmptyState';
import { cn } from '@/lib/utils';

interface ScenarioPanelProps {
  scenarios: ScenarioV2[];
  activeScenario: string | undefined;
  /** 활성 시나리오와 작업 공간의 차이. */
  diff: WorkspaceDiff | undefined;
  /** 라이브러리에 케이스가 있는지(새 시나리오를 만들 수 있는지). */
  hasLibrary: boolean;
  onActivate: (name: string) => void;
  onEdit: (scenario: ScenarioV2) => void;
  onDelete: (name: string) => void;
  /** 활성 시나리오를 작업 공간 내용으로 갱신. */
  onUpdateActive: () => void;
  onNew: () => void;
  onOpenLibrary: () => void;
}

/** 변경 요약 툴팁(수정/추가/제외된 엔드포인트). */
function diffTitle(diff: WorkspaceDiff): string {
  const lines: string[] = [];
  if (diff.changed.length) lines.push(`수정: ${diff.changed.join(', ')}`);
  if (diff.added.length) lines.push(`추가: ${diff.added.join(', ')}`);
  if (diff.removed.length) lines.push(`제외: ${diff.removed.join(', ')}`);
  return lines.join('\n');
}

/**
 * 시나리오 = 재사용하는 케이스 선택의 묶음. 활성화하면 작업 공간(목)에 풀어 넣고,
 * 작업 공간을 고치면 "수정됨"으로 표시해 시나리오에 반영하거나 되돌릴 수 있다.
 */
export function ScenarioPanel({
  scenarios,
  activeScenario,
  diff,
  hasLibrary,
  onActivate,
  onEdit,
  onDelete,
  onUpdateActive,
  onNew,
  onOpenLibrary
}: ScenarioPanelProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="mr-auto text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          시나리오 ({scenarios.length})
        </h3>
        <Button variant="ghost" size="sm" onClick={onOpenLibrary}>
          <Library /> 케이스 라이브러리
        </Button>
        <Button variant="outline" size="sm" disabled={!hasLibrary} onClick={onNew} title={hasLibrary ? undefined : '먼저 목을 "케이스로 저장"하세요'}>
          <Plus /> 새 시나리오
        </Button>
      </div>

      {scenarios.length === 0 ? (
        <EmptyState
          compact
          icon={Layers}
          title="저장된 시나리오가 없습니다"
          description='목 정의를 만든 뒤 "시나리오 저장"을 누르면 케이스 라이브러리에 저장되고, 여러 시나리오가 같은 케이스를 재사용합니다.'
        />
      ) : (
        scenarios.map((s) => {
          const active = s.name === activeScenario;
          const dirty = active && !!diff?.dirty;
          return (
            <div
              key={s.name}
              className={cn('flex flex-col gap-1.5 rounded-md border p-2', active ? 'border-primary bg-accent' : 'border-border')}
            >
              <div className="flex items-center gap-2">
                {active && <CheckCircle2 className="size-4 shrink-0 text-primary" />}
                <span className="min-w-0 flex-1 truncate text-sm font-medium" title={s.name}>
                  {s.name}
                </span>
                {active && <Badge variant="success">활성</Badge>}
                {dirty && diff && (
                  <Badge variant="warning" title={diffTitle(diff)}>
                    수정됨 {diff.changed.length + diff.added.length + diff.removed.length}
                  </Badge>
                )}
              </div>
              {(s.description || s.base || (s.tags && s.tags.length > 0)) && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {s.base && (
                    <span className="inline-flex items-center gap-1" title={`${s.base}를 상속하고 일부만 덮어씁니다`}>
                      <GitBranch className="size-3" />
                      {s.base}
                    </span>
                  )}
                  {s.description && <span className="min-w-0 truncate">{s.description}</span>}
                  {s.tags?.map((t) => (
                    <span key={t} className="rounded-sm bg-muted px-1 font-mono text-2xs">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-auto text-xs text-muted-foreground">
                  케이스 {s.picks.filter((p) => p.caseId !== null).length}개
                  {s.base ? ' (덮어쓴 것만)' : ''}
                </span>
                {dirty ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => onActivate(s.name)} title="저장된 시나리오 내용으로 작업 공간을 되돌립니다">
                      <RotateCcw /> 되돌리기
                    </Button>
                    <Button size="sm" onClick={onUpdateActive} title="현재 작업 공간 내용을 이 시나리오에 저장합니다">
                      <Upload /> 현재 작업 반영
                    </Button>
                  </>
                ) : (
                  <Button variant={active ? 'ghost' : 'default'} size="sm" disabled={active} onClick={() => onActivate(s.name)}>
                    <Play /> {active ? '적용됨' : '활성화'}
                  </Button>
                )}
                <Button variant="ghost" size="icon" aria-label="편집" onClick={() => onEdit(s)}>
                  <Pencil />
                </Button>
                <Button variant="ghost" size="icon" aria-label="삭제" onClick={() => onDelete(s.name)}>
                  <Trash2 />
                </Button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
