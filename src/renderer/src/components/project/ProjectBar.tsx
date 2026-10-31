import { FolderOpen, Plus } from 'lucide-react';
import type { OpenProject } from '@shared/project';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface ProjectBarProps {
  project: OpenProject | undefined;
  onCreate: () => void;
  onOpen: () => void;
}

export function ProjectBar({
  project,
  onCreate,
  onOpen
}: ProjectBarProps): JSX.Element {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      {project ? (
        <Badge variant="info">{project.meta.name}</Badge>
      ) : (
        <span className="text-sm text-muted-foreground">프로젝트가 열려있지 않습니다</span>
      )}

      <div className="flex-1" />

      <Button variant="ghost" size="sm" onClick={onCreate}>
        <Plus /> 새 프로젝트
      </Button>
      <Button variant="ghost" size="sm" onClick={onOpen}>
        <FolderOpen /> 열기
      </Button>
    </div>
  );
}
