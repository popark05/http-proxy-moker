import { useEffect, useRef, useState } from 'react';
import { Pencil, Trash2, Save, FileJson, RotateCcw } from 'lucide-react';
import type { MockDefinition, MockFault } from '@shared/mock';
import type { AppMode } from '../../state/app-mode';
import { restartAnimation } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '../common/EmptyState';
import { isBodyModified } from '@shared/mock';
import { methodTone, statusTone } from '../primitives';
import { MockEditor } from './MockEditor';

/** fault 종류를 짧은 라벨로. */
function faultLabel(fault: MockFault): string {
  switch (fault) {
    case 'timeout':
      return '타임아웃';
    case 'reset':
      return 'RST';
    case 'close':
      return '연결종료';
    default:
      return '';
  }
}

interface MockPanelProps {
  mocks: MockDefinition[];
  mode: AppMode;
  blockUnmatched: boolean;
  onBlockUnmatchedChange: (block: boolean) => void;
  onUpdate: (mock: MockDefinition) => void;
  onRemove: (id: string) => void;
  onSaveScenario: (name: string) => void;
  /** mockId별 누적 히트 수(목킹 응답 횟수). */
  hitCounts?: Record<string, number>;
  /** mockId별 마지막 히트 시각(플래시 트리거). */
  lastHitAt?: Record<string, number>;
  /** 히트 카운트 초기화. */
  onResetHits?: () => void;
}

export function MockPanel({
  mocks,
  mode,
  blockUnmatched,
  onBlockUnmatchedChange,
  onUpdate,
  onRemove,
  onSaveScenario,
  hitCounts = {},
  lastHitAt = {},
  onResetHits
}: MockPanelProps): JSX.Element {
  const [editing, setEditing] = useState<MockDefinition | undefined>(undefined);
  const [editorOpen, setEditorOpen] = useState(false);
  const [scenarioName, setScenarioName] = useState('scenario-1');

  const openEditor = (mock: MockDefinition): void => {
    setEditing(mock);
    setEditorOpen(true);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          목 정의 ({mocks.length})
        </h3>
        {onResetHits && Object.keys(hitCounts).length > 0 && (
          <Button variant="ghost" size="sm" className="mr-auto" onClick={onResetHits}>
            <RotateCcw /> 응답 횟수 초기화
          </Button>
        )}
        <div className="flex items-center gap-1">
          <Input
            aria-label="시나리오 이름"
            value={scenarioName}
            onChange={(e) => setScenarioName(e.target.value)}
            className="h-8 w-28"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={mocks.length === 0}
            onClick={() => onSaveScenario(scenarioName)}
          >
            <Save /> 시나리오 저장
          </Button>
        </div>
      </div>

      {mode === 'mock' && (
        <label className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
          <Switch
            checked={blockUnmatched}
            onCheckedChange={onBlockUnmatchedChange}
            aria-label="매칭 안 된 요청 차단"
          />
          매칭 안 된 요청 차단 (완전 목킹 전용, 백엔드 통과 안 함)
        </label>
      )}

      {mocks.length === 0 ? (
        <EmptyState
          compact
          icon={FileJson}
          title="목 정의가 없습니다"
          description='왼쪽 트래픽에서 응답을 고른 뒤 "목으로 복제"를 누르면 여기에 추가됩니다.'
        />
      ) : (
        mocks.map((mock) => (
          <MockRow
            key={mock.id}
            mock={mock}
            hitCount={hitCounts[mock.id] ?? 0}
            lastHitAt={lastHitAt[mock.id] ?? 0}
            onEdit={() => openEditor(mock)}
            onRemove={() => onRemove(mock.id)}
          />
        ))
      )}

      <MockEditor mock={editing} open={editorOpen} onOpenChange={setEditorOpen} onSave={onUpdate} />
    </div>
  );
}

interface MockRowProps {
  mock: MockDefinition;
  hitCount: number;
  lastHitAt: number;
  onEdit: () => void;
  onRemove: () => void;
}

/** 목 정의 한 행. mock-hit 발생 시 배경 플래시 + 히트 카운트 표시. */
function MockRow({ mock, hitCount, lastHitAt, onEdit, onRemove }: MockRowProps): JSX.Element {
  const rowRef = useRef<HTMLDivElement>(null);
  const hitBadgeRef = useRef<HTMLSpanElement>(null);
  const prevHit = useRef(lastHitAt);

  useEffect(() => {
    if (lastHitAt && lastHitAt !== prevHit.current) {
      prevHit.current = lastHitAt;
      restartAnimation(rowRef.current, 'animate-mock-hit-flash');
      restartAnimation(hitBadgeRef.current, 'animate-mock-hit-pop');
    }
  }, [lastHitAt]);

  return (
    <div
      ref={rowRef}
      className="flex items-center gap-2 rounded-md border border-border p-2"
    >
      <Badge variant={methodTone(mock.method)}>{mock.method}</Badge>
      <span className="min-w-0 flex-1 truncate font-mono text-sm" title={mock.path}>
        {mock.path}
      </span>
      {hitCount > 0 && (
        <Badge ref={hitBadgeRef} variant="success" title="이 목이 응답한 횟수">
          {hitCount}회 응답
        </Badge>
      )}
      {isBodyModified(mock) && (
        <Badge variant="info" title="원본 응답에서 본문이 수정됨">
          수정됨
        </Badge>
      )}
      {mock.delayMs ? <Badge variant="warning">{mock.delayMs}ms</Badge> : null}
      {mock.fault && mock.fault !== 'none' ? (
        <Badge variant="error">{faultLabel(mock.fault)}</Badge>
      ) : (
        <Badge variant={statusTone(mock.response.status)}>{mock.response.status}</Badge>
      )}
      <Button variant="ghost" size="icon" aria-label="편집" onClick={onEdit}>
        <Pencil />
      </Button>
      <Button variant="ghost" size="icon" aria-label="삭제" onClick={onRemove}>
        <Trash2 />
      </Button>
    </div>
  );
}
