import { useState } from 'react';
import { FlaskConical, FolderOpen, Plus, Radio, ShieldCheck } from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Switch } from '@astryxdesign/core/Switch';
import { TopNav } from '@astryxdesign/core/TopNav';
import type { OpenProject } from '@shared/project';
import { cn } from '@/lib/utils';
import { LogoWordmark } from '../brand/Logo';
import { CaExportModal } from '../cert/CaExportModal';
import { useAppMode } from '../../state/app-mode';

interface TopBarProps {
  project: OpenProject | undefined;
  onCreateProject: () => void;
  onOpenProject: () => void;
}

/**
 * 상단 내비게이션(Astryx TopNav). macOS 신호등 공간과 드래그 영역은 globals.css의 `.astryx-top-nav` 규칙이 맡는다.
 * "목 적용" 스위치와 아래 선 색으로 목 적용 여부를 강하게 구분해 QA가 착각하지 않도록 한다.
 * 내부 값은 모드(capture|mock)이고, "프록시가 목을 적용하는가"만 바꾸는 전역 설정이다. 목 상태(활성 개수, 시나리오)는 하단 상태바가 보여 준다.
 * 프로젝트(이름 + 새로 만들기/열기)도 여기에 둔다.
 */
export function TopBar({ project, onCreateProject, onOpenProject }: TopBarProps): React.JSX.Element {
  const { mode, setMode } = useAppMode();
  const [caOpen, setCaOpen] = useState(false);
  const isMock = mode === 'mock';

  return (
    <>
      <TopNav
        label="앱"
        className={cn('border-b-2', isMock ? 'border-b-[hsl(var(--warning))]' : 'border-b-primary')}
        heading={<LogoWordmark />}
        startContent={
          // 켜면 프록시가 목으로 응답하고, 끄면 실제 서버 응답을 그대로 캡처한다.
          <>
            <Switch label="목 적용" value={isMock} onChange={(on) => setMode(on ? 'mock' : 'capture')} />
            <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', isMock ? 'text-[hsl(var(--warning))]' : 'text-muted-foreground')}>
              {isMock ? <FlaskConical className="size-3.5" /> : <Radio className="size-3.5" />}
              {isMock ? '목 적용 중' : '꺼짐 · 실제 응답 캡처'}
            </span>
          </>
        }
        endContent={
          <>
            <span className="max-w-60 truncate text-sm text-muted-foreground" title={project?.meta.name}>
              {project ? project.meta.name : '프로젝트가 열려있지 않습니다'}
            </span>
            <Button variant="ghost" size="sm" label="새 프로젝트" icon={<Icon icon={Plus} />} onClick={onCreateProject} />
            <Button variant="ghost" size="sm" label="열기" icon={<Icon icon={FolderOpen} />} onClick={onOpenProject} />
            <Button variant="ghost" size="sm" label="CA" icon={<Icon icon={ShieldCheck} />} onClick={() => setCaOpen(true)} />
          </>
        }
      />
      <CaExportModal open={caOpen} onOpenChange={setCaOpen} />
    </>
  );
}
