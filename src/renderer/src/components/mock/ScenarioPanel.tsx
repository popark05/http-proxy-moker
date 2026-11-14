import { CheckCircle2, GitBranch, Layers, Pencil, Play, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import type { ScenarioV2, WorkspaceDiff } from '@shared/scenario-library';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { Badge } from '@astryxdesign/core/Badge';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { EmptyState } from '../common/EmptyState';
import { cn } from '@/lib/utils';

interface ScenarioPanelProps {
  scenarios: ScenarioV2[];
  activeScenario: string | undefined;
  /** 활성 시나리오와 현재 목의 차이. */
  diff: WorkspaceDiff | undefined;
  /** 라이브러리에 케이스가 있는지(새 시나리오를 만들 수 있는지). */
  hasLibrary: boolean;
  onActivate: (name: string) => void;
  onEdit: (scenario: ScenarioV2) => void;
  onDelete: (name: string) => void;
  /** 활성 시나리오를 현재 목 내용으로 갱신. */
  onUpdateActive: () => void;
  onNew: () => void;
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
 * 시나리오 = 재사용하는 케이스 선택의 묶음. 활성화하면 현재 목(목)에 풀어 넣고,
 * 현재 목을 고치면 "수정됨"으로 표시해 시나리오에 반영하거나 되돌릴 수 있다.
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
  onNew
}: ScenarioPanelProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="mr-auto text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          시나리오 ({scenarios.length})
        </h3>
        <Button
          label="새 시나리오"
          icon={<Icon icon={Plus} />}
          variant="secondary"
          size="sm"
          tooltip={hasLibrary ? undefined : '먼저 목을 "케이스로 저장"하세요'}
          isDisabled={!hasLibrary}
          onClick={onNew}
        />
      </div>

      {scenarios.length === 0 ? (
        <EmptyState
          compact
          icon={Layers}
          title="저장된 시나리오가 없습니다"
          description='목 정의를 만든 뒤 "시나리오 저장"을 누르면 응답 케이스에 저장되고, 여러 시나리오가 같은 케이스를 재사용합니다.'
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
                {active && <Badge variant="success" label="활성" />}
                {dirty && diff && (
                  <Tooltip content={diffTitle(diff)} hasHoverIndication={false}>
                    <Badge variant="warning" label={`수정됨 ${diff.changed.length + diff.added.length + diff.removed.length}`} />
                  </Tooltip>
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
                    <Button
                      label="되돌리기"
                      icon={<Icon icon={RotateCcw} />}
                      variant="secondary"
                      size="sm"
                      tooltip="저장된 시나리오 내용으로 현재 목을 되돌립니다"
                      onClick={() => onActivate(s.name)}
                    />
                    <Button
                      label="현재 작업 반영"
                      icon={<Icon icon={Upload} />}
                      variant="primary"
                      size="sm"
                      tooltip="현재 목 내용을 이 시나리오에 저장합니다"
                      onClick={onUpdateActive}
                    />
                  </>
                ) : (
                  <Button
                    label={active ? '적용됨' : '활성화'}
                    icon={<Icon icon={Play} />}
                    variant={active ? 'ghost' : 'primary'}
                    size="sm"
                    isDisabled={active}
                    onClick={() => onActivate(s.name)}
                  />
                )}
                <IconButton
                  label="편집"
                  icon={<Icon icon={Pencil} />}
                  variant="ghost"
                  onClick={() => onEdit(s)}
                />
                <IconButton
                  label="삭제"
                  icon={<Icon icon={Trash2} />}
                  variant="ghost"
                  onClick={() => onDelete(s.name)}
                />
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
