import { useState } from 'react';
import { Pencil, Trash2, Save } from 'lucide-react';
import type { MockDefinition, MockFault } from '@shared/mock';
import type { AppMode } from '../../state/app-mode';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
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
}

export function MockPanel({
  mocks,
  mode,
  blockUnmatched,
  onBlockUnmatchedChange,
  onUpdate,
  onRemove,
  onSaveScenario
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
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          목 정의 ({mocks.length})
        </h3>
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
        <div className="p-2 text-xs text-muted-foreground">
          캡처된 응답에서 "목으로 복제"를 눌러 목 정의를 만드세요.
        </div>
      ) : (
        mocks.map((mock) => (
          <div key={mock.id} className="flex items-center gap-2 rounded-md border border-border p-2">
            <Badge variant={methodTone(mock.method)}>{mock.method}</Badge>
            <span className="min-w-0 flex-1 truncate font-mono text-[13px]" title={mock.path}>
              {mock.path}
            </span>
            {mock.delayMs ? <Badge variant="warning">{mock.delayMs}ms</Badge> : null}
            {mock.fault && mock.fault !== 'none' ? (
              <Badge variant="error">{faultLabel(mock.fault)}</Badge>
            ) : (
              <Badge variant={statusTone(mock.response.status)}>{mock.response.status}</Badge>
            )}
            <Button variant="ghost" size="icon" aria-label="편집" onClick={() => openEditor(mock)}>
              <Pencil />
            </Button>
            <Button variant="ghost" size="icon" aria-label="삭제" onClick={() => onRemove(mock.id)}>
              <Trash2 />
            </Button>
          </div>
        ))
      )}

      <MockEditor mock={editing} open={editorOpen} onOpenChange={setEditorOpen} onSave={onUpdate} />
    </div>
  );
}
