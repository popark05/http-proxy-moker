import { Activity, FolderTree, Smartphone } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** 좌측 Rail에서 고르는 사이드바 섹션. 이후 단계에서 프로젝트 트리 등이 추가된다. */
export type SidebarSection = 'traffic' | 'project' | 'connect';

export const SIDEBAR_SECTIONS: ReadonlyArray<{ id: SidebarSection; label: string; icon: LucideIcon }> = [
  { id: 'traffic', label: '트래픽', icon: Activity },
  { id: 'project', label: '프로젝트', icon: FolderTree },
  { id: 'connect', label: '기기 연결', icon: Smartphone }
];
