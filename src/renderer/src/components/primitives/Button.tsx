import * as React from 'react';
import { Button as UiButton, type ButtonProps as UiButtonProps } from '@/components/ui/button';

type LegacyVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type LegacySize = 'sm' | 'md';

/** 기존 styled-components Button API($variant/$size)를 shadcn Button으로 매핑하는 어댑터. */
export interface ButtonProps
  extends Omit<UiButtonProps, 'variant' | 'size'> {
  $variant?: LegacyVariant;
  $size?: LegacySize;
}

const variantMap: Record<LegacyVariant, UiButtonProps['variant']> = {
  primary: 'default',
  secondary: 'outline',
  ghost: 'ghost',
  danger: 'destructive'
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ $variant = 'secondary', $size = 'md', ...props }, ref) => (
    <UiButton
      ref={ref}
      variant={variantMap[$variant]}
      size={$size === 'sm' ? 'sm' : 'default'}
      {...props}
    />
  )
);
Button.displayName = 'Button';
