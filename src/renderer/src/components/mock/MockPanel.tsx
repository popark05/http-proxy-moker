import { useState } from 'react';
import styled from 'styled-components';
import { PencilSimple, Trash, FloppyDisk } from '@phosphor-icons/react';
import type { MockDefinition, MockFault } from '@shared/mock';
import type { AppMode } from '../../state/app-mode';
import { Button, Badge, Toggle, methodTone, statusTone } from '../primitives';
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

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space.sm};
`;

const Head = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.space.sm};
`;

const HeadTitle = styled.h3`
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: ${({ theme }) => theme.mutedText};
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.sm};
  padding: ${({ theme }) => theme.space.sm};
  border: 1px solid ${({ theme }) => theme.borderSubtle};
  border-radius: ${({ theme }) => theme.radii.md};
`;

const Path = styled.span`
  flex: 1;
  min-width: 0;
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: ${({ theme }) => theme.fontSizes.input};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Empty = styled.div`
  color: ${({ theme }) => theme.mutedText};
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
  padding: ${({ theme }) => theme.space.sm};
`;

interface MockPanelProps {
  mocks: MockDefinition[];
  mode: AppMode;
  blockUnmatched: boolean;
  onBlockUnmatchedChange: (block: boolean) => void;
  onUpdate: (mock: MockDefinition) => void;
  onRemove: (id: string) => void;
  onSaveScenario: (name: string) => void;
}

const PolicyRow = styled.label`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.sm};
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
  color: ${({ theme }) => theme.secondaryText};
  padding: ${({ theme }) => theme.space.xs} 0;
`;

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
    <Wrap>
      <Head>
        <HeadTitle>목 정의 ({mocks.length})</HeadTitle>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            aria-label="시나리오 이름"
            value={scenarioName}
            onChange={(e) => setScenarioName(e.target.value)}
            style={{ width: 110 }}
          />
          <Button
            $variant="secondary"
            $size="sm"
            disabled={mocks.length === 0}
            onClick={() => onSaveScenario(scenarioName)}
          >
            <FloppyDisk size={14} /> 시나리오 저장
          </Button>
        </div>
      </Head>

      {mode === 'mock' && (
        <PolicyRow>
          <Toggle
            checked={blockUnmatched}
            onCheckedChange={onBlockUnmatchedChange}
            aria-label="매칭 안 된 요청 차단"
          />
          매칭 안 된 요청 차단 (완전 목킹 전용, 백엔드 통과 안 함)
        </PolicyRow>
      )}

      {mocks.length === 0 ? (
        <Empty>캡처된 응답에서 "목으로 복제"를 눌러 목 정의를 만드세요.</Empty>
      ) : (
        mocks.map((mock) => (
          <Row key={mock.id}>
            <Badge $tone={methodTone(mock.method)}>{mock.method}</Badge>
            <Path title={mock.path}>{mock.path}</Path>
            {mock.delayMs ? <Badge $tone="warning">{mock.delayMs}ms</Badge> : null}
            {mock.fault && mock.fault !== 'none' ? (
              <Badge $tone="error">{faultLabel(mock.fault)}</Badge>
            ) : (
              <Badge $tone={statusTone(mock.response.status)}>{mock.response.status}</Badge>
            )}
            <Button $variant="ghost" $size="sm" aria-label="편집" onClick={() => openEditor(mock)}>
              <PencilSimple size={14} />
            </Button>
            <Button
              $variant="ghost"
              $size="sm"
              aria-label="삭제"
              onClick={() => onRemove(mock.id)}
            >
              <Trash size={14} />
            </Button>
          </Row>
        ))
      )}

      <MockEditor
        mock={editing}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onSave={onUpdate}
      />
    </Wrap>
  );
}
