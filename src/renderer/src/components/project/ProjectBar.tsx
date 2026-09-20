import { useState } from 'react';
import styled from 'styled-components';
import { FolderOpen, FloppyDisk, Plus } from '@phosphor-icons/react';
import type { OpenProject } from '@shared/project';
import type { CapturedExchange } from '@shared/capture';
import { Button, Badge } from '../primitives';

const Bar = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.sm};
  padding: ${({ theme }) => `${theme.space.sm} ${theme.space.md}`};
  border-bottom: 1px solid ${({ theme }) => theme.borderSubtle};
`;

const Name = styled.span`
  font-size: ${({ theme }) => theme.fontSizes.input};
  color: ${({ theme }) => theme.secondaryText};
`;

const Spacer = styled.div`
  flex: 1;
`;

const Select = styled.select`
  background: ${({ theme }) => theme.panelRaisedBackground};
  color: ${({ theme }) => theme.primaryText};
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `2px ${theme.space.sm}`};
  font-size: ${({ theme }) => theme.fontSizes.input};
`;

interface ProjectBarProps {
  project: OpenProject | undefined;
  exchanges: CapturedExchange[];
  onCreate: (name: string) => void;
  onOpen: () => void;
  onSave: (name: string) => void;
  onLoadSession: (name: string) => void;
}

export function ProjectBar({
  project,
  exchanges,
  onCreate,
  onOpen,
  onSave,
  onLoadSession
}: ProjectBarProps): JSX.Element {
  const [sessionName, setSessionName] = useState('session-1');

  return (
    <Bar>
      {project ? (
        <>
          <Badge $tone="info">{project.meta.name}</Badge>
          <input
            aria-label="세션 이름"
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            style={{ width: 120 }}
          />
          <Button
            $variant="secondary"
            $size="sm"
            disabled={exchanges.length === 0}
            onClick={() => onSave(sessionName)}
          >
            <FloppyDisk size={14} /> 저장
          </Button>
          {project.captureSessions.length > 0 && (
            <Select
              aria-label="세션 불러오기"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) onLoadSession(e.target.value);
              }}
            >
              <option value="">세션 불러오기…</option>
              {project.captureSessions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          )}
        </>
      ) : (
        <Name>프로젝트가 열려있지 않습니다</Name>
      )}

      <Spacer />

      <Button $variant="ghost" $size="sm" onClick={() => onCreate('QA Project')}>
        <Plus size={14} /> 새 프로젝트
      </Button>
      <Button $variant="ghost" $size="sm" onClick={onOpen}>
        <FolderOpen size={14} /> 열기
      </Button>
    </Bar>
  );
}
