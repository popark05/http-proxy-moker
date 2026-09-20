import styled, { css } from 'styled-components';
import { transparentize } from 'polished';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps {
  $variant?: Variant;
  $size?: 'sm' | 'md';
}

const variantStyles = {
  primary: css`
    background: ${({ theme }) => theme.accent};
    color: ${({ theme }) => theme.accentText};
    border: 1px solid transparent;
    &:hover:not(:disabled) {
      background: ${({ theme }) => theme.accentHover};
    }
  `,
  secondary: css`
    background: transparent;
    color: ${({ theme }) => theme.primaryText};
    border: 1px solid ${({ theme }) => theme.border};
    &:hover:not(:disabled) {
      background: ${({ theme }) => theme.panelRaisedBackground};
    }
  `,
  ghost: css`
    background: transparent;
    color: ${({ theme }) => theme.secondaryText};
    border: 1px solid transparent;
    &:hover:not(:disabled) {
      background: ${({ theme }) => theme.panelRaisedBackground};
      color: ${({ theme }) => theme.primaryText};
    }
  `,
  danger: css`
    background: ${({ theme }) => theme.statusError};
    color: ${({ theme }) => theme.accentText};
    border: 1px solid transparent;
    &:hover:not(:disabled) {
      background: ${({ theme }) => transparentize(0.15, theme.statusError)};
    }
  `
} as const;

export const Button = styled.button<ButtonProps>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.space.sm};
  font-family: ${({ theme }) => theme.fonts.sans};
  font-size: ${({ theme, $size }) =>
    $size === 'sm' ? theme.fontSizes.input : theme.fontSizes.text};
  font-weight: 500;
  padding: ${({ theme, $size }) =>
    $size === 'sm' ? `${theme.space.xs} ${theme.space.md}` : `${theme.space.sm} ${theme.space.lg}`};
  border-radius: ${({ theme }) => theme.radii.md};
  cursor: pointer;
  transition:
    background 0.12s ease,
    color 0.12s ease;

  ${({ $variant = 'secondary' }) => variantStyles[$variant]}

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;
