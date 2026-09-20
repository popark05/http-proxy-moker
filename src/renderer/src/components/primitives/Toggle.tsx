import * as Switch from '@radix-ui/react-switch';
import styled from 'styled-components';

const Root = styled(Switch.Root)`
  all: unset;
  width: 40px;
  height: 22px;
  background: ${({ theme }) => theme.border};
  border-radius: ${({ theme }) => theme.radii.pill};
  position: relative;
  cursor: pointer;
  transition: background 0.12s ease;

  &[data-state='checked'] {
    background: ${({ theme }) => theme.accent};
  }

  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.accentHover};
    outline-offset: 2px;
  }
`;

const Thumb = styled(Switch.Thumb)`
  display: block;
  width: 18px;
  height: 18px;
  background: ${({ theme }) => theme.accentText};
  border-radius: 50%;
  transition: transform 0.12s ease;
  transform: translateX(2px);
  will-change: transform;

  &[data-state='checked'] {
    transform: translateX(20px);
  }
`;

interface ToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  'aria-label'?: string;
}

/** Radix Switch 기반 토글. */
export function Toggle(props: ToggleProps): JSX.Element {
  return (
    <Root
      id={props.id}
      checked={props.checked}
      onCheckedChange={props.onCheckedChange}
      aria-label={props['aria-label']}
    >
      <Thumb />
    </Root>
  );
}
