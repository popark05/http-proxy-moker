import styled from 'styled-components';
import { Trash, Play, CheckCircle } from '@phosphor-icons/react';
import { Button, Badge } from '../primitives';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space.sm};
`;

const HeadTitle = styled.h3`
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: ${({ theme }) => theme.mutedText};
`;

const Row = styled.div<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.sm};
  padding: ${({ theme }) => theme.space.sm};
  border: 1px solid
    ${({ theme, $active }) => ($active ? theme.accent : theme.borderSubtle)};
  border-radius: ${({ theme }) => theme.radii.md};
  background: ${({ theme, $active }) => ($active ? theme.panelRaisedBackground : 'transparent')};
`;

const Name = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: ${({ theme }) => theme.fontSizes.input};
`;

const Empty = styled.div`
  color: ${({ theme }) => theme.mutedText};
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
  padding: ${({ theme }) => theme.space.sm};
`;

interface ScenarioPanelProps {
  scenarios: string[];
  activeScenario: string | undefined;
  onActivate: (name: string) => void;
  onDelete: (name: string) => void;
}

/** 저장된 목 시나리오 목록. 활성 시나리오 표시 + 활성화/삭제. */
export function ScenarioPanel({
  scenarios,
  activeScenario,
  onActivate,
  onDelete
}: ScenarioPanelProps): JSX.Element {
  return (
    <Wrap>
      <HeadTitle>시나리오 ({scenarios.length})</HeadTitle>

      {scenarios.length === 0 ? (
        <Empty>저장된 시나리오가 없습니다. 목 정의를 만든 뒤 "시나리오 저장"을 누르세요.</Empty>
      ) : (
        scenarios.map((name) => {
          const active = name === activeScenario;
          return (
            <Row key={name} $active={active}>
              {active && <CheckCircle size={16} weight="fill" />}
              <Name title={name}>{name}</Name>
              {active && <Badge $tone="success">활성</Badge>}
              <Button
                $variant={active ? 'ghost' : 'primary'}
                $size="sm"
                disabled={active}
                onClick={() => onActivate(name)}
              >
                <Play size={14} /> {active ? '적용됨' : '활성화'}
              </Button>
              <Button $variant="ghost" $size="sm" aria-label="삭제" onClick={() => onDelete(name)}>
                <Trash size={14} />
              </Button>
            </Row>
          );
        })
      )}
    </Wrap>
  );
}
