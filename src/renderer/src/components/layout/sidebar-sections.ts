import { Activity, BookMarked, FlaskConical, FolderTree, Smartphone } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** 좌측 Rail에서 고르는 섹션(위에서부터 이 순서). connect·mocking·collection은 사이드바가 아니라 전체 화면을 쓴다(FULL_VIEW_SECTIONS). */
export type SidebarSection = 'traffic' | 'project' | 'connect' | 'mocking' | 'collection';

export const SIDEBAR_SECTIONS: ReadonlyArray<{ id: SidebarSection; label: string; icon: LucideIcon }> = [
  { id: 'connect', label: '기기 연결', icon: Smartphone },
  { id: 'traffic', label: '트래픽', icon: Activity },
  { id: 'mocking', label: '목킹', icon: FlaskConical },
  { id: 'collection', label: '컬렉션', icon: BookMarked },
  { id: 'project', label: '프로젝트', icon: FolderTree }
];

/** 사이드바와 워크스페이스 자리를 모두 쓰는 섹션. */
export const FULL_VIEW_SECTIONS: ReadonlySet<SidebarSection> = new Set(['connect', 'mocking', 'collection']);
