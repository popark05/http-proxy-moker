import { useEffect, useRef, useState } from 'react';
import { Pencil, Trash2, Save, FileJson, RotateCcw, BookmarkPlus, Upload } from 'lucide-react';
import type { MockDefinition, MockFault } from '@shared/mock';
import type { AppMode } from '../../state/app-mode';
import { restartAnimation } from '@/lib/utils';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { Switch } from '@astryxdesign/core/Switch';
import { EmptyState } from '../common/EmptyState';
import { isBodyModified } from '@shared/mock';
import { methodTone, statusTone } from '../primitives';
import { MockEditor } from './MockEditor';
import { TextInput } from '@astryxdesign/core/TextInput';

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
  /** 목을 케이스로 저장(출처 케이스가 있으면 그 케이스에 반영). */
  onSaveCase?: (mock: MockDefinition) => void;
  /** 출처 케이스 이름(라이브러리에서 풀어낸 목이면). */
  caseNameOf?: (mock: MockDefinition) => string | undefined;
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
  onSaveCase,
  caseNameOf,
  hitCounts = {},
  lastHitAt = {},
  onResetHits
}: MockPanelProps): React.JSX.Element {
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
          <Button
            label="응답 횟수 초기화"
            icon={<Icon icon={RotateCcw} />}
            variant="ghost"
            size="sm"
            className="mr-auto"
            onClick={onResetHits}
          />
        )}
        <div className="flex items-center gap-1">
          <TextInput
            label="시나리오 이름"
            isLabelHidden
            size="sm"
            width={112}
            value={scenarioName}
            onChange={setScenarioName}
          />
          <Button
            label="시나리오 저장"
            icon={<Icon icon={Save} />}
            variant="secondary"
            size="sm"
            isDisabled={mocks.length === 0}
            onClick={() => onSaveScenario(scenarioName)}
          />
        </div>
      </div>

      {mode === 'mock' && (
        <Switch
          label="매칭 안 된 요청 차단 (완전 목킹 전용, 백엔드 통과 안 함)"
          size="sm"
          value={blockUnmatched}
          onChange={onBlockUnmatchedChange}
        />
      )}

      {mocks.length === 0 ? (
        <EmptyState
          compact
          icon={FileJson}
          title="목 정의가 없습니다"
          description='왼쪽 트래픽에서 요청을 우클릭해 "목으로 복제"를 고르면 여기에 추가됩니다.'
        />
      ) : (
        mocks.map((mock) => (
          <MockRow
            key={mock.id}
            mock={mock}
            hitCount={hitCounts[mock.id] ?? 0}
            lastHitAt={lastHitAt[mock.id] ?? 0}
            caseName={caseNameOf?.(mock)}
            onSaveCase={onSaveCase ? () => onSaveCase(mock) : undefined}
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
  caseName?: string;
  onSaveCase?: () => void;
}

/** 목 정의 한 행. mock-hit 발생 시 배경 플래시 + 히트 카운트 표시. */
function MockRow({ mock, hitCount, lastHitAt, onEdit, onRemove, caseName, onSaveCase }: MockRowProps): React.JSX.Element {
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
      <Badge variant={methodTone(mock.method)} label={mock.method} />
      <span className="min-w-0 flex-1 truncate font-mono text-sm" title={`${mock.host}${mock.path}`}>
        {mock.host && <span className="text-muted-foreground">{mock.host}</span>}
        {mock.path}
      </span>
      {caseName && (
        <Tooltip content="응답 케이스에서 가져온 목" hasHoverIndication={false}><Badge variant="neutral" label={caseName} /></Tooltip>
      )}
      {hitCount > 0 && (
        <span ref={hitBadgeRef} className="inline-flex rounded-md">
          <Tooltip content="이 목이 응답한 횟수" hasHoverIndication={false}>
            <Badge variant="success" label={`${hitCount}회 응답`} />
          </Tooltip>
        </span>
      )}
      {mock.response.bodyEncoding === 'base64' && (
        <Tooltip content="이진 본문(이미지 등)" hasHoverIndication={false}><Badge variant="neutral" label="이진" /></Tooltip>
      )}
      {isBodyModified(mock) && (
        <Tooltip content="원본 응답에서 본문이 수정됨" hasHoverIndication={false}><Badge variant="info" label="수정됨" /></Tooltip>
      )}
      {mock.delayMs ? <Badge variant="warning" label={`${mock.delayMs}ms`} /> : null}
      {mock.fault && mock.fault !== 'none' ? (
        <Badge variant="error" label={faultLabel(mock.fault)} />
      ) : (
        <Badge variant={statusTone(mock.response.status)} label={mock.response.status} />
      )}
      {onSaveCase && (
        <IconButton
          label={caseName ? '케이스에 반영' : '케이스로 저장'}
          icon={<Icon icon={caseName ? Upload : BookmarkPlus} />}
          variant="ghost"
          tooltip={caseName ? '수정한 내용을 라이브러리 케이스에 반영(이 케이스를 쓰는 모든 시나리오에 적용)' : '라이브러리에 케이스로 저장'}
          onClick={onSaveCase}
        />
      )}
      <IconButton label="편집" icon={<Icon icon={Pencil} />} variant="ghost" onClick={onEdit} />
      <IconButton label="삭제" icon={<Icon icon={Trash2} />} variant="ghost" onClick={onRemove} />
    </div>
  );
}
