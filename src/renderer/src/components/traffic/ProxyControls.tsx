import styled from 'styled-components';
import { Play, Stop, Trash } from '@phosphor-icons/react';
import type { ProxyStatus } from '@shared/capture';
import { Button, Badge } from '../primitives';

const Bar = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.sm};
  padding: ${({ theme }) => `${theme.space.sm} ${theme.space.md}`};
  border-bottom: 1px solid ${({ theme }) => theme.borderSubtle};
`;

const Spacer = styled.div`
  flex: 1;
`;

interface ProxyControlsProps {
  status: ProxyStatus;
  count: number;
  onStart: () => void;
  onStop: () => void;
  onClear: () => void;
}

export function ProxyControls({
  status,
  count,
  onStart,
  onStop,
  onClear
}: ProxyControlsProps): JSX.Element {
  return (
    <Bar>
      {status.running ? (
        <Button $variant="danger" $size="sm" onClick={onStop}>
          <Stop size={14} weight="fill" /> 중지
        </Button>
      ) : (
        <Button $variant="primary" $size="sm" onClick={onStart}>
          <Play size={14} weight="fill" /> 프록시 시작
        </Button>
      )}

      {status.running && <Badge $tone="success">:{status.port} 수신 중</Badge>}

      <Spacer />

      <Badge $tone="neutral">{count} 건</Badge>
      <Button $variant="ghost" $size="sm" onClick={onClear} aria-label="캡처 지우기">
        <Trash size={14} />
      </Button>
    </Bar>
  );
}
