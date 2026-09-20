import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import styled from 'styled-components';
import { transparentize } from 'polished';

const Overlay = styled(Dialog.Overlay)`
  position: fixed;
  inset: 0;
  background: ${({ theme }) => transparentize(0.3, theme.appBackground)};
  z-index: ${({ theme }) => theme.zIndex.modal};
`;

const Content = styled(Dialog.Content)`
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  min-width: 420px;
  max-width: 90vw;
  max-height: 85vh;
  overflow: auto;
  background: ${({ theme }) => theme.panelBackground};
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: ${({ theme }) => theme.radii.lg};
  box-shadow: 0 12px 40px ${({ theme }) => theme.shadow};
  padding: ${({ theme }) => theme.space.xl};
  z-index: ${({ theme }) => theme.zIndex.modal};
`;

const Title = styled(Dialog.Title)`
  font-size: ${({ theme }) => theme.fontSizes.heading};
  font-weight: 600;
  margin-bottom: ${({ theme }) => theme.space.md};
`;

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  trigger?: ReactNode;
}

/** Radix Dialog 기반 모달. */
export function Modal({ open, onOpenChange, title, children, trigger }: ModalProps): JSX.Element {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Overlay />
        <Content>
          <Title>{title}</Title>
          {children}
        </Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
