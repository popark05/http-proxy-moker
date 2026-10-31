import { useState } from 'react';
import { FileCheck, FolderOpen, Save, Plus } from 'lucide-react';
import type { OpenProject } from '@shared/project';
import type { CapturedExchange } from '@shared/capture';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

interface ProjectBarProps {
  project: OpenProject | undefined;
  exchanges: CapturedExchange[];
  onCreate: (name: string) => void;
  onOpen: () => void;
  onSave: (name: string) => void;
  onLoadSession: (name: string) => void;
  /** 계약 테스트 화면 열기(프로젝트가 없으면 버튼 비활성). */
  onOpenContracts?: () => void;
  contractCount?: number;
}

export function ProjectBar({
  project,
  exchanges,
  onCreate,
  onOpen,
  onSave,
  onLoadSession,
  onOpenContracts,
  contractCount = 0
}: ProjectBarProps): JSX.Element {
  const [sessionName, setSessionName] = useState('session-1');

  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      {project ? (
        <>
          <Badge variant="info">{project.meta.name}</Badge>
          <Input
            aria-label="세션 이름"
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            className="h-8 w-32"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={exchanges.length === 0}
            onClick={() => onSave(sessionName)}
          >
            <Save /> 저장
          </Button>
          {project.captureSessions.length > 0 && (
            <select
              aria-label="세션 불러오기"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) onLoadSession(e.target.value);
              }}
              className="h-8 rounded-md border border-input bg-transparent px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">세션 불러오기…</option>
              {project.captureSessions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
        </>
      ) : (
        <span className="text-sm text-muted-foreground">프로젝트가 열려있지 않습니다</span>
      )}

      <div className="flex-1" />

      {onOpenContracts && (
        <Button
          variant="outline"
          size="sm"
          disabled={!project}
          title={project ? undefined : '프로젝트를 열면 사용할 수 있습니다'}
          onClick={onOpenContracts}
        >
          <FileCheck /> 계약 테스트{contractCount > 0 ? ` (${contractCount})` : ''}
        </Button>
      )}

      <Button variant="ghost" size="sm" onClick={() => onCreate('QA Project')}>
        <Plus /> 새 프로젝트
      </Button>
      <Button variant="ghost" size="sm" onClick={onOpen}>
        <FolderOpen /> 열기
      </Button>
    </div>
  );
}
