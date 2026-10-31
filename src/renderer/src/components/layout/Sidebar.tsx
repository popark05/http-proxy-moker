import type { ComponentProps, ReactNode } from 'react';
import { DevicePanel } from '../device/DevicePanel';
import { ProxyControls } from '../traffic/ProxyControls';
import type { SidebarSection } from './sidebar-sections';

interface SidebarProps {
  section: SidebarSection;
  proxyProps: ComponentProps<typeof ProxyControls>;
  deviceProps: ComponentProps<typeof DevicePanel>;
  /** 트래픽 섹션 내용(남는 높이를 쓴다). */
  traffic: ReactNode;
  /** 프로젝트 트리 섹션 내용. */
  projectTree: ReactNode;
}

/** 사이드바. 프록시 컨트롤은 섹션과 무관하게 항상 맨 위에 둔다(목킹에서도 프록시 시작이 필요하다). */
export function Sidebar({ section, proxyProps, deviceProps, traffic, projectTree }: SidebarProps): JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <ProxyControls {...proxyProps} />
      {section === 'traffic' ? (
        <div className="min-h-0 flex-1">{traffic}</div>
      ) : section === 'project' ? (
        <div className="min-h-0 flex-1">{projectTree}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-4 py-2">
          <DevicePanel {...deviceProps} />
        </div>
      )}
    </div>
  );
}
