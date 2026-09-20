import * as RadixTabs from '@radix-ui/react-tabs';
import styled from 'styled-components';

/** Radix Tabs 기반 — 키보드/ARIA는 Radix가 보장하고 스타일만 입힌다. */
export const Tabs = RadixTabs.Root;

export const TabsList = styled(RadixTabs.List)`
  display: flex;
  gap: ${({ theme }) => theme.space.xs};
  border-bottom: 1px solid ${({ theme }) => theme.borderSubtle};
  padding: 0 ${({ theme }) => theme.space.sm};
`;

export const TabTrigger = styled(RadixTabs.Trigger)`
  appearance: none;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: ${({ theme }) => theme.secondaryText};
  font-family: ${({ theme }) => theme.fonts.sans};
  font-size: ${({ theme }) => theme.fontSizes.text};
  padding: ${({ theme }) => `${theme.space.sm} ${theme.space.md}`};
  cursor: pointer;

  &[data-state='active'] {
    color: ${({ theme }) => theme.primaryText};
    border-bottom-color: ${({ theme }) => theme.accent};
  }

  &:hover {
    color: ${({ theme }) => theme.primaryText};
  }
`;

export const TabContent = styled(RadixTabs.Content)`
  padding: ${({ theme }) => theme.space.md};
  outline: none;
`;
