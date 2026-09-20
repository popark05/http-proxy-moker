import { useEffect, useState } from 'react';
import type { SetupStep } from '@shared/device';
import { Modal } from '../primitives';
import { Button } from '@/components/ui/button';

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
      <ol className="mb-4 flex flex-col gap-3">
        {steps.map((step, i) => (
          <li key={i} className="border-l-2 border-primary pl-3">
            <div className="mb-0.5 font-semibold">{step.title}</div>
            <div className="text-[13px] leading-relaxed text-muted-foreground">{step.detail}</div>
            {step.value && (
              <code className="mt-1 inline-block rounded-sm bg-muted px-2 py-0.5 font-mono text-[13px]">
                {step.value}
              </code>
            )}
          </li>
        ))}
      </ol>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void window.mokerApi.ca.export('mobileconfig')}>
          .mobileconfig 내보내기
        </Button>
        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
          닫기
        </Button>
      </div>
    </Modal>
  );
}
