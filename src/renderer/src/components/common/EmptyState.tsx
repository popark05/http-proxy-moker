import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

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

/** 일관된 빈 상태 표시: 아이콘 + 제목 + 설명 + (선택) CTA. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false
}: EmptyStateProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-1.5 px-4 py-6' : 'gap-2 px-6 py-12',
        className
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-full bg-muted/60 text-muted-foreground',
          compact ? 'size-9' : 'size-12'
        )}
      >
        <Icon className={compact ? 'size-4' : 'size-5'} />
      </div>
      <div className={cn('font-medium text-foreground', compact ? 'text-sm' : 'text-base')}>
        {title}
      </div>
      {description && (
        <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
