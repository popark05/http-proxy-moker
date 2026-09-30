import { useEffect, useState } from 'react';
import { Download, Monitor, Smartphone } from 'lucide-react';
import type { SetupStep } from '@shared/device';
import { Modal } from '../primitives';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface IosSetupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 단계를 수행하는 곳 표시: PC는 강조색(primary), 기기는 중립색. */
function WhereBadge({ where }: { where: SetupStep['where'] }): JSX.Element {
  const isPc = where === 'pc';
  const Icon = isPc ? Monitor : Smartphone;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs font-medium',
        isPc ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
      )}
    >
      <Icon className="size-3" />
      {isPc ? '이 PC에서' : 'iPhone/iPad에서'}
    </span>
  );
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
          <li key={i} className="flex gap-3">
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                step.where === 'pc' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
              )}
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="font-semibold">{step.title}</span>
                <WhereBadge where={step.where} />
              </div>
              <div className="text-sm leading-relaxed text-muted-foreground">{step.detail}</div>
              {step.value && (
                <code className="mt-1 inline-block rounded-sm bg-muted px-2 py-0.5 font-mono text-sm">
                  {step.value}
                </code>
              )}
              {step.action === 'exportCa' && (
                <div className="mt-2">
                  <Button size="sm" onClick={() => void window.mokerApi.ca.export('mobileconfig')}>
                    <Download /> .mobileconfig 내보내기
                  </Button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
          닫기
        </Button>
      </div>
    </Modal>
  );
}
