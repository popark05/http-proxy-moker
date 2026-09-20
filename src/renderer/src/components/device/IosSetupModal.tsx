import { useEffect, useState } from 'react';
import styled from 'styled-components';
import type { SetupStep } from '@shared/device';
import { Modal, Button } from '../primitives';

const StepList = styled.ol`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space.md};
  margin-bottom: ${({ theme }) => theme.space.lg};
`;

const Step = styled.li`
  border-left: 2px solid ${({ theme }) => theme.accent};
  padding-left: ${({ theme }) => theme.space.md};
`;

const StepTitle = styled.div`
  font-weight: 600;
  margin-bottom: ${({ theme }) => theme.space.xs};
`;

const StepDetail = styled.div`
  font-size: ${({ theme }) => theme.fontSizes.input};
  color: ${({ theme }) => theme.secondaryText};
  line-height: 1.5;
`;

const StepValue = styled.code`
  display: inline-block;
  margin-top: ${({ theme }) => theme.space.xs};
  padding: ${({ theme }) => `2px ${theme.space.sm}`};
  background: ${({ theme }) => theme.panelRaisedBackground};
  border-radius: ${({ theme }) => theme.radii.sm};
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: ${({ theme }) => theme.fontSizes.input};
`;

const Actions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.space.sm};
`;

interface IosSetupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IosSetupModal({ open, onOpenChange }: IosSetupModalProps): JSX.Element {
  const [steps, setSteps] = useState<SetupStep[]>([]);

  useEffect(() => {
    if (open) {
      void window.mokerApi.device.setupInstructions('ios').then(setSteps);
    }
  }, [open]);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="iOS 인터셉션 셋업">
      <StepList>
        {steps.map((step, i) => (
          <Step key={i}>
            <StepTitle>{step.title}</StepTitle>
            <StepDetail>{step.detail}</StepDetail>
            {step.value && <StepValue>{step.value}</StepValue>}
          </Step>
        ))}
      </StepList>
      <Actions>
        <Button
          $variant="primary"
          $size="sm"
          onClick={() => void window.mokerApi.ca.export('mobileconfig')}
        >
          .mobileconfig 내보내기
        </Button>
        <Button $variant="secondary" $size="sm" onClick={() => onOpenChange(false)}>
          닫기
        </Button>
      </Actions>
    </Modal>
  );
}
