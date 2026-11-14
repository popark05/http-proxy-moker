import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Download, Hand, Zap } from 'lucide-react';
import { connectionProgress, type StepStatus, type WizardInput, type WizardTab } from '@shared/connection-progress';
import { Modal } from '../primitives';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { cn } from '@/lib/utils';
import { ConnectionScene } from './ConnectionScene';

export type WizardPlatformTab = 'android-usb' | 'android-wifi' | 'ios-wifi';
type AndroidWifiVariant = 'adb' | 'manual';

export interface ConnectionWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 처음 보여줄 탭. */
  initialTab?: WizardPlatformTab;
  input: Omit<WizardInput, 'proxyAddress'>;
}

function toWizardTab(tab: WizardPlatformTab, variant: AndroidWifiVariant): WizardTab {
  if (tab === 'android-wifi') return variant === 'adb' ? 'android-wifi-adb' : 'android-wifi-manual';
  return tab;
}

function StatusDot({ status, index }: { status: StepStatus; index: number }): React.JSX.Element {
  const base = 'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold';
  if (status === 'done') {
    return (
      <span className={cn(base, 'border-[hsl(var(--success))] bg-[hsl(var(--success))]/15 text-[hsl(var(--success))]')} aria-label="완료">
        <Check className="size-3.5" />
      </span>
    );
  }
  if (status === 'blocked') {
    return (
      <span className={cn(base, 'border-[hsl(var(--warning))] bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))]')} aria-label="확인 필요">
        <AlertTriangle className="size-3.5" />
      </span>
    );
  }
  if (status === 'current') {
    return (
      <span className={cn(base, 'border-primary bg-primary text-primary-foreground')} aria-label="지금 할 일">
        {index + 1}
      </span>
    );
  }
  return (
    <span className={cn(base, 'border-border text-muted-foreground')} aria-label="대기">
      {index + 1}
    </span>
  );
}

type GuideTab = WizardPlatformTab;

export interface ConnectionGuideProps {
  /** 안내를 켜 둘 때만 프록시 주소를 조회한다(모달이 닫혀 있으면 false). */
  active: boolean;
  tab: GuideTab;
  onTabChange: (tab: GuideTab) => void;
  input: Omit<WizardInput, 'proxyAddress'>;
}

/** 탭별 단계를 앱의 실제 상태로 자동 체크하며 보여 주는 안내와 연결 그림. 모달과 전체 화면에서 같이 쓴다. */
export function ConnectionGuide({ active, tab, onTabChange, input }: ConnectionGuideProps): React.JSX.Element {
  const [variant, setVariant] = useState<AndroidWifiVariant>('adb');
  const [proxyAddress, setProxyAddress] = useState<string | undefined>();

  // 기기가 접속할 프록시 주소(host:port)는 iOS 셋업 안내의 "프록시 수동 설정" 단계 값을 재사용한다.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void window.mokerApi.device
      .setupInstructions('ios')
      .then((steps) => {
        if (!cancelled) setProxyAddress(steps.find((s) => s.value)?.value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active, input.proxyRunning]);

  const wizardTab = toWizardTab(tab, variant);
  const steps = useMemo(
    () => connectionProgress(wizardTab, { ...input, proxyAddress }),
    [wizardTab, input, proxyAddress]
  );
  const doneCount = steps.filter((s) => s.status === 'done').length;

  return (
    <>
      <TabList role="tablist" value={tab} onChange={(v) => onTabChange(v as GuideTab)} hasDivider>
        <Tab value="android-usb" label="Android · USB" />
        <Tab value="android-wifi" label="Android · Wi-Fi" />
        <Tab value="ios-wifi" label="iPhone/iPad · Wi-Fi" />
      </TabList>
      <div className="mb-4" />

      {tab === 'android-wifi' && (
        <div className="flex gap-1.5 text-xs" role="group" aria-label="Android Wi-Fi 방식">
          <Button
            label="USB 제어 + Wi-Fi 트래픽"
            variant={variant === 'adb' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setVariant('adb')}
          />
          <Button
            label="수동 프록시 (adb 없이)"
            variant={variant === 'manual' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setVariant('manual')}
          />
        </div>
      )}

      {/* 그림을 위에 넓게, 단계는 그 아래에 둔다. */}
      <div className="flex flex-col gap-6">
        <ConnectionScene tab={wizardTab} steps={steps} />
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {doneCount}/{steps.length} 단계 완료 · 앱 상태에 따라 자동으로 체크됩니다
          </p>
          <ol className="flex flex-col">
            {steps.map((step, i) => (
              <li key={step.id} className="relative flex gap-3 pb-4 last:pb-0">
                {i < steps.length - 1 && <span aria-hidden className="absolute left-3 top-6 -ml-px h-[calc(100%-1.5rem)] border-l border-border" />}
                <StatusDot status={step.status} index={i} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('text-sm font-medium', step.status === 'pending' && 'text-muted-foreground')}>{step.title}</span>
                    <span
                      className="inline-flex items-center gap-0.5 rounded-sm bg-muted px-1 py-0.5 font-mono text-2xs text-muted-foreground"
                      title={step.kind === 'auto' ? '앱이 확인합니다' : '직접 해야 하는 단계입니다'}
                    >
                      {step.kind === 'auto' ? <Zap className="size-2.5" /> : <Hand className="size-2.5" />}
                      {step.kind === 'auto' ? '자동' : '수동'}
                    </span>
                  </div>
                  {(step.status === 'current' || step.status === 'blocked') && (
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
                  )}
                  {step.value && step.status !== 'done' && (
                    <code className="mt-1 inline-block rounded-sm bg-muted px-2 py-0.5 font-mono text-sm">{step.value}</code>
                  )}
                  {step.status === 'blocked' && step.reason && (
                    <p className="mt-1 text-xs leading-relaxed text-[hsl(var(--warning))]">{step.reason}</p>
                  )}
                  {step.id === 'profile' && step.status !== 'pending' && (
                    <Button
                      label="CA 프로파일 내보내기 (.mobileconfig)"
                      icon={<Icon icon={Download} />}
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      onClick={() => void window.mokerApi.ca.export('mobileconfig')}
                    />
                  )}
                  {step.id === 'ca' && step.status !== 'pending' && (
                    <Button
                      label="CA 내보내기 (.pem)"
                      icon={<Icon icon={Download} />}
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      onClick={() => void window.mokerApi.ca.export('pem')}
                    />
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </>
  );
}

/** 기기 연결 마법사(모달). 전체 화면 안내는 ConnectionGuide를 직접 쓴다. */
export function ConnectionWizard({ open, onOpenChange, initialTab = 'android-usb', input }: ConnectionWizardProps): React.JSX.Element {
  const [tab, setTab] = useState<WizardPlatformTab>(initialTab);

  // 열 때마다 요청된 탭으로 맞춘다.
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="기기 연결 가이드" width={896}>
      <ConnectionGuide active={open} tab={tab} onTabChange={setTab} input={input} />
      <div className="flex justify-end">
        <Button label="닫기" variant="secondary" size="sm" onClick={() => onOpenChange(false)} />
      </div>
    </Modal>
  );
}
