import { Laptop, Padlock, Phone, Router } from '@lucasmarkes/hairline/react';
import type { WizardStep, WizardTab } from '@shared/connection-progress';
import { cn } from '@/lib/utils';

interface ConnectionSceneProps {
  tab: WizardTab;
  steps: WizardStep[];
}

/** 신뢰/인증서 단계에서는 가운데 도형을 자물쇠로 바꾼다. */
const TRUST_STEPS = new Set(['ca', 'profile', 'trust', 'https']);

function Figure({ children, label, narrow }: { children: JSX.Element; label: string; narrow?: boolean }): JSX.Element {
  return (
    <div className={cn('flex min-w-0 shrink-0 flex-col items-center gap-1', narrow ? 'w-[24%]' : 'w-[28%]')}>
      <div className="w-full">{children}</div>
      <div className="max-w-full truncate text-center font-mono text-2xs uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

/** 선과 그 위를 지나는 패킷 칩. flowing이면 트래픽이 흐르는 중. */
function Connector({
  label,
  flowing,
  active,
  dashed
}: {
  label: string;
  flowing: boolean;
  active: boolean;
  dashed?: boolean;
}): JSX.Element {
  return (
    <div className="relative flex min-w-0 flex-1 flex-col items-center justify-center self-stretch pb-8">
      <div className="relative w-full">
        <div
          className={cn(
            'w-full border-t',
            dashed ? 'border-dashed' : 'border-solid',
            active ? 'border-primary' : 'border-border'
          )}
        />
        {flowing && (
          <>
            <span className="wizard-packet absolute -top-2.5 rounded-sm bg-primary/15 px-1 font-mono text-2xs text-primary">GET</span>
            <span
              className="wizard-packet absolute -top-2.5 rounded-sm bg-primary/15 px-1 font-mono text-2xs text-primary"
              style={{ animationDelay: '1.2s' }}
            >
              HTTPS
            </span>
          </>
        )}
      </div>
      <div className="mt-1.5 max-w-full truncate font-mono text-2xs text-muted-foreground">{label}</div>
    </div>
  );
}

/**
 * 기기 ─ (공유기) ─ PC 장면. 어느 단계가 현재인지에 따라 연결선 강조/패킷/가운데 도형이 바뀐다.
 * hairline 도형은 포인터에만 반응하므로 연결선과 패킷은 직접 그린다.
 */
export function ConnectionScene({ tab, steps }: ConnectionSceneProps): JSX.Element {
  const byId = (id: string): WizardStep | undefined => steps.find((s) => s.id === id);
  const current = steps.find((s) => s.status === 'current' || s.status === 'blocked');
  const flowing = byId('traffic')?.status === 'done';
  const hasRouter = tab !== 'android-usb';
  const trustPhase = !!current && TRUST_STEPS.has(current.id);
  const interceptDone = byId('intercept')?.status === 'done';

  const middle = hasRouter ? (
    <Figure narrow label={trustPhase ? 'CA 신뢰' : '공유기'}>
      {trustPhase ? <Padlock label="인증서 신뢰" /> : <Router label="공유기" />}
    </Figure>
  ) : null;

  const lineLabel = (side: 'a' | 'b'): string => {
    if (tab === 'android-usb') return interceptDone ? 'USB · adb reverse 127.0.0.1' : 'USB 케이블';
    return side === 'a' ? 'Wi-Fi' : 'LAN';
  };

  return (
    <div className="wizard-figures flex flex-col gap-2 self-start rounded-lg border border-border p-4">
      <div className="flex items-center">
        <Figure narrow={hasRouter} label={tab === 'ios-wifi' ? 'iPhone' : 'Android'}>
          <Phone label={tab === 'ios-wifi' ? 'iPhone 또는 iPad' : 'Android 기기'} />
        </Figure>
        <Connector label={lineLabel('a')} flowing={flowing} active={flowing || !!interceptDone} />
        {middle}
        {hasRouter && <Connector label={lineLabel('b')} flowing={flowing} active={flowing} />}
        <Figure narrow={hasRouter} label="이 PC">
          <Laptop label="이 PC" />
        </Figure>
      </div>
      {tab === 'android-wifi-adb' && (
        <p className="text-center font-mono text-2xs text-muted-foreground">
          USB 케이블은 adb 제어(인터셉트 명령)에만 쓰이고, 트래픽은 Wi-Fi로 흐릅니다.
        </p>
      )}
    </div>
  );
}
