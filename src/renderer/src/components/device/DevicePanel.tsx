import { useState } from 'react';
import { Smartphone, Apple, RefreshCw } from 'lucide-react';
import type {
  AndroidInterceptionMode,
  DeviceInfo,
  InterceptionResult
} from '@shared/device';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useDevices } from '../../state/useDevices';
import { IosSetupModal } from './IosSetupModal';

function statusTone(status: DeviceInfo['status']): 'success' | 'warning' | 'neutral' {
  if (status === 'ready') return 'success';
  if (status === 'unauthorized' || status === 'offline') return 'warning';
  return 'neutral';
}

function usedModeLabel(mode: 'root' | 'vpn' | undefined): string {
  if (mode === 'root') return '시스템 CA';
  if (mode === 'vpn') return 'VPN';
  return '';
}

/** 인터셉션 결과를 배지 문구/톤으로 변환한다. */
function interceptionBadge(result: InterceptionResult): {
  tone: 'success' | 'warning';
  text: string;
} {
  const modePrefix = usedModeLabel(result.usedMode);
  const prefix = modePrefix ? `${modePrefix} · ` : '';
  if (!result.caInstalled) {
    return { tone: 'warning', text: `${prefix}HTTP만 (HTTPS 복호화 불가)` };
  }
  if (result.usedMode === 'vpn') {
    return { tone: 'success', text: `${prefix}HTTPS 복호화 (유저 CA 신뢰 앱)` };
  }
  return { tone: 'success', text: `${prefix}HTTPS 복호화 활성` };
}

function DeviceItem({
  device,
  interception,
  onStart,
  onStop,
  onIosSetup
}: {
  device: DeviceInfo;
  interception: InterceptionResult | undefined;
  onStart: (mode: AndroidInterceptionMode) => void;
  onStop: () => void;
  onIosSetup: () => void;
}): JSX.Element {
  const active = !!interception;
  const isIos = device.platform === 'ios';
  const [mode, setMode] = useState<AndroidInterceptionMode>('auto');

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 rounded-md border border-border p-2">
        {isIos ? (
          <Apple className="size-[18px] shrink-0" />
        ) : (
          <Smartphone className="size-[18px] shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px]" title={device.id}>
            {device.name}
          </div>
        </div>
        <Badge variant={statusTone(device.status)}>{device.status}</Badge>

        {!isIos && !active && (
          <select
            aria-label="인터셉션 방식"
            value={mode}
            onChange={(e) => setMode(e.target.value as AndroidInterceptionMode)}
            className="rounded-md border border-input bg-transparent px-1.5 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="auto">자동</option>
            <option value="root">시스템 CA (root)</option>
            <option value="vpn">VPN (non-root)</option>
          </select>
        )}

        {isIos ? (
          <Button variant="outline" size="sm" onClick={onIosSetup}>
            셋업 가이드
          </Button>
        ) : active ? (
          <Button variant="destructive" size="sm" onClick={onStop}>
            해제
          </Button>
        ) : (
          <Button size="sm" disabled={device.status !== 'ready'} onClick={() => onStart(mode)}>
            인터셉트
          </Button>
        )}
      </div>
      {active && !isIos && (
        <Badge variant={interceptionBadge(interception!).tone}>
          {interceptionBadge(interception!).text}
        </Badge>
      )}
      {interception && interception.warnings.length > 0 && (
        <ul className="ml-4 list-disc text-xs leading-relaxed text-[hsl(var(--warning))]">
          {interception.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DevicePanel(): JSX.Element {
  const { devices, refreshing, refresh, interceptions, start, stop } = useDevices();
  const [iosSetupOpen, setIosSetupOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          기기
        </h3>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setIosSetupOpen(true)}>
            <Apple /> iOS 셋업
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="기기 새로고침"
            onClick={() => void refresh()}
          >
            <RefreshCw className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? '검색 중' : '새로고침'}
          </Button>
        </div>
      </div>

      {devices.length === 0 ? (
        <div className="p-2 text-xs text-muted-foreground">
          연결된 기기가 없습니다. Android는 ADB로, iOS는 USB로 연결하세요.
        </div>
      ) : (
        devices.map((device) => (
          <DeviceItem
            key={device.id}
            device={device}
            interception={interceptions[device.id]}
            onStart={(mode) => void start(device, mode)}
            onStop={() => void stop(device)}
            onIosSetup={() => setIosSetupOpen(true)}
          />
        ))
      )}

      <IosSetupModal open={iosSetupOpen} onOpenChange={setIosSetupOpen} />
    </div>
  );
}
