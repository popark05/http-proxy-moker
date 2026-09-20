import styled from 'styled-components';
import { transparentize } from 'polished';

interface ChipProps {
  $active?: boolean;
}

/** 토글 가능한 필터 칩. 선택 시 accent 색으로 강조. */
export const Chip = styled.button<ChipProps>`
  display: inline-flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.xs};
  padding: ${({ theme }) => `2px ${theme.space.sm}`};
  border-radius: ${({ theme }) => theme.radii.pill};
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
  cursor: pointer;
  white-space: nowrap;
  transition:
    background 0.1s ease,
    color 0.1s ease;

  color: ${({ theme, $active }) => ($active ? theme.accentText : theme.secondaryText)};
  background: ${({ theme, $active }) =>
    $active ? theme.accent : transparentize(0.85, theme.mutedText)};
  border: 1px solid
    ${({ theme, $active }) => ($active ? theme.accent : theme.borderSubtle)};

  &:hover {
    color: ${({ theme, $active }) => ($active ? theme.accentText : theme.primaryText)};
  }
`;
