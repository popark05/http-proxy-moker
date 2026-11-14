import type { LucideIcon } from 'lucide-react';
import { EmptyState as AstryxEmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** 선택적 행동 유도(CTA) 영역. */
  action?: React.ReactNode;
  className?: string;
  /** 컴팩트 모드(사이드 패널 등 좁은 곳). */
  compact?: boolean;
}

/** 일관된 빈 상태 표시: 아이콘 + 제목 + 설명 + (선택) CTA. Astryx EmptyState 위의 얇은 어댑터. */
export function EmptyState({ icon, title, description, action, className, compact = false }: EmptyStateProps): React.JSX.Element {
  return (
    <AstryxEmptyState
      icon={<Icon icon={icon} />}
      title={title}
      description={description}
      actions={action}
      isCompact={compact}
      className={className}
    />
  );
}
