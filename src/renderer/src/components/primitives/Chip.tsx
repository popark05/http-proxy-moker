import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  $active?: boolean;
}

/** 토글 가능한 필터 칩. 선택 시 primary 강조. (기존 $active API 유지) */
export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  ({ $active = false, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-xs transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        $active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground',
        className
      )}
      {...props}
    />
  )
);
Chip.displayName = 'Chip';
