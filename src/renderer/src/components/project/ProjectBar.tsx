import { useState } from 'react';
import { FolderOpen, Save, Plus } from 'lucide-react';
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
              className="h-8 rounded-md border border-input bg-transparent px-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        <span className="text-[13px] text-muted-foreground">프로젝트가 열려있지 않습니다</span>
      )}

      <div className="flex-1" />

      <Button variant="ghost" size="sm" onClick={() => onCreate('QA Project')}>
        <Plus /> 새 프로젝트
      </Button>
      <Button variant="ghost" size="sm" onClick={onOpen}>
        <FolderOpen /> 열기
      </Button>
    </div>
  );
}
