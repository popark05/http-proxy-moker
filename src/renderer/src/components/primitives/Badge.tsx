import styled from 'styled-components';
import { transparentize } from 'polished';
import type { AppTheme } from '../../theme/theme';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

interface BadgeProps {
  $tone?: BadgeTone;
}

function toneColor(theme: AppTheme, tone: BadgeTone): string {
  switch (tone) {
    case 'info':
      return theme.statusInfo;
    case 'success':
      return theme.statusSuccess;
    case 'warning':
      return theme.statusWarning;
    case 'error':
      return theme.statusError;
    default:
      return theme.mutedText;
  }
}

/**
 * 상태/카테고리 배지. 색상만이 아니라 항상 텍스트(자식)를 함께 표기해
 * 색맹 사용자도 구분 가능하도록 한다(접근성).
 */
export const Badge = styled.span<BadgeProps>`
  display: inline-flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.xs};
  padding: ${({ theme }) => `2px ${theme.space.sm}`};
  border-radius: ${({ theme }) => theme.radii.sm};
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
  font-weight: 500;
  line-height: 1.5;
  white-space: nowrap;
  color: ${({ theme, $tone = 'neutral' }) => toneColor(theme, $tone)};
  background: ${({ theme, $tone = 'neutral' }) => transparentize(0.82, toneColor(theme, $tone))};
  border: 1px solid ${({ theme, $tone = 'neutral' }) => transparentize(0.55, toneColor(theme, $tone))};
`;

/** HTTP 상태 코드를 톤으로 매핑. */
export function statusTone(statusCode: number): BadgeTone {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warning';
  if (statusCode >= 300) return 'info';
  if (statusCode >= 200) return 'success';
  return 'neutral';
}

/** HTTP 메서드를 톤으로 매핑. */
export function methodTone(method: string): BadgeTone {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'info';
    case 'POST':
      return 'success';
    case 'PUT':
    case 'PATCH':
      return 'warning';
    case 'DELETE':
      return 'error';
    default:
      return 'neutral';
  }
}
