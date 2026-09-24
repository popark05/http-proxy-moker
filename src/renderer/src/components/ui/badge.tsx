import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs font-medium leading-5 whitespace-nowrap transition-colors',
  {
    variants: {
      variant: {
        neutral: 'border-border bg-muted/40 text-muted-foreground',
        info: 'border-primary/40 bg-primary/15 text-primary',
        success: 'border-[hsl(var(--success)/0.4)] bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]',
        warning: 'border-[hsl(var(--warning)/0.4)] bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]',
        error: 'border-destructive/40 bg-destructive/15 text-destructive'
      }
    },
    defaultVariants: {
      variant: 'neutral'
    }
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  )
);
Badge.displayName = 'Badge';

export { Badge, badgeVariants };
