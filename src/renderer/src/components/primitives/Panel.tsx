import * as React from 'react';
import { cn } from '@/lib/utils';

/** 콘텐츠를 담는 기본 표면. (기존 Panel/PanelHeader/PanelBody API 유지) */
export const Panel = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <section
      ref={ref}
      className={cn('overflow-hidden rounded-lg border border-border bg-card', className)}
      {...props}
    />
  )
);
Panel.displayName = 'Panel';

export function PanelHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>): JSX.Element {
  return (
    <header
      className={cn(
        'flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-base font-semibold',
        className
      )}
      {...props}
    />
  );
}

export function PanelBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={cn('p-4', className)} {...props} />;
}
