import type { ComponentProps, ReactNode } from 'react';
import { CaptureControls } from '../traffic/CaptureControls';
import type { SidebarSection } from './sidebar-sections';

interface SidebarProps {
  section: SidebarSection;
  captureProps: ComponentProps<typeof CaptureControls>;
  /** 트래픽 섹션 내용(남는 높이를 쓴다). */
  traffic: ReactNode;
  /** 프로젝트 트리 섹션 내용. */
  projectTree: ReactNode;
}

/** 사이드바(트래픽·프로젝트). 기록 컨트롤은 섹션과 무관하게 항상 맨 위에 둔다. */
export function Sidebar({ section, captureProps, traffic, projectTree }: SidebarProps): JSX.Element {
  return (
    <aside aria-label="사이드바" className="flex h-full flex-col">
      <CaptureControls {...captureProps} />
      {section === 'traffic' && <div className="min-h-0 flex-1">{traffic}</div>}
      {section === 'project' && <div className="min-h-0 flex-1">{projectTree}</div>}
    </aside>
  );
}
