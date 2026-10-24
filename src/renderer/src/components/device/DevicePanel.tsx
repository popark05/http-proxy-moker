import { useState } from 'react';
import { toast } from 'sonner';
import { Smartphone, Apple, RefreshCw, SmartphoneNfc, CircleHelp, Loader2 } from 'lucide-react';
import type {
  AndroidInterceptionMode,
  AndroidTrafficPath,
  DeviceInfo,
  InterceptionResult
} from '@shared/device';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '../common/EmptyState';
import { interceptionStarted, useDevices } from '../../state/useDevices';
import { withProgress } from '../../state/with-progress';
import { operationId } from '@shared/progress';
import { ConnectionWizard } from './ConnectionWizard';
import { ClientList } from './ClientList';
import type { ClientInfo } from '@shared/clients';

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
  busy,
  onStart,
  onStop,
  onIosSetup
}: {
  device: DeviceInfo;
  interception: InterceptionResult | undefined;
  /** 인터셉트 시작/해제 진행 중이면 버튼을 잠근다. */
  busy?: 'starting' | 'stopping';
  onStart: (mode: AndroidInterceptionMode, trafficPath: AndroidTrafficPath) => void;
  onStop: () => void;
  onIosSetup: () => void;
}): JSX.Element {
  const active = !!interception;
  const isIos = device.platform === 'ios';
  const [mode, setMode] = useState<AndroidInterceptionMode>('auto');
  const [trafficPath, setTrafficPath] = useState<AndroidTrafficPath>('usb');

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
        {isIos ? (
          <Apple className="size-[18px] shrink-0" />
        ) : (
          <Smartphone className="size-[18px] shrink-0" />
        )}
        <div className="min-w-[6rem] flex-1">
          <div className="truncate text-sm" title={device.id}>
            {device.name}
          </div>
        </div>
        <Badge variant={statusTone(device.status)}>{device.status}</Badge>

        {!isIos && !active && (
          <select
            aria-label="인터셉션 방식"
            disabled={!!busy}
            value={mode}
            onChange={(e) => setMode(e.target.value as AndroidInterceptionMode)}
            className="rounded-md border border-input bg-transparent px-1.5 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="auto">자동</option>
            <option value="root">시스템 CA (root)</option>
            <option value="vpn">VPN (non-root)</option>
          </select>
        )}

        {!isIos && !active && (
          <select
            aria-label="트래픽 경로"
            disabled={!!busy}
            title="기기 트래픽이 PC 프록시에 도달하는 경로"
            value={trafficPath}
            onChange={(e) => setTrafficPath(e.target.value as AndroidTrafficPath)}
            className="rounded-md border border-input bg-transparent px-1.5 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="usb">USB 터널</option>
            <option value="wifi">Wi-Fi</option>
          </select>
        )}

        {isIos ? (
          <Button variant="outline" size="sm" onClick={onIosSetup}>
            셋업 가이드
          </Button>
        ) : busy ? (
          <Button size="sm" variant="outline" disabled aria-busy="true">
            <Loader2 className="animate-spin" /> {busy === 'starting' ? '연결 중…' : '해제 중…'}
          </Button>
        ) : active ? (
          <Button variant="destructive" size="sm" onClick={onStop}>
            해제
          </Button>
        ) : (
          <Button size="sm" disabled={device.status !== 'ready'} onClick={() => onStart(mode, trafficPath)}>
            인터셉트
          </Button>
        )}
      </div>
      {device.status !== 'ready' && device.statusDetail && (
        <p className="ml-1 text-xs leading-relaxed text-[hsl(var(--warning))]">
          {device.statusDetail}
        </p>
      )}
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

interface DevicePanelProps {
  /** 프록시에 접속한 기기(트래픽 기반). */
  clients: ClientInfo[];
  now: number;
  proxyRunning: boolean;
  /** 이 IP의 요청만 보기(같은 기기를 다시 누르면 해제). */
  onFilterClient: (ip: string | undefined) => void;
  activeClientFilter: string | undefined;
  /** 접속 IP 없는 요청 수. */
  untrackedCount: number;
}

export function DevicePanel({ clients, now, proxyRunning, onFilterClient, activeClientFilter, untrackedCount }: DevicePanelProps): JSX.Element {
  const { devices, refreshing, refresh, interceptions, start, stop } = useDevices({
    onInterceptionLost: (device) =>
      toast.warning('기기에서 인터셉션이 해제되었습니다', {
        description: `${device.name}: companion 앱 연결이 끊겼거나 프록시 설정이 지워졌습니다. 다시 인터셉트하세요.`
      })
  });
  const [wizard, setWizard] = useState<{ open: boolean; tab: 'android-usb' | 'ios-wifi' }>({
    open: false,
    tab: 'android-usb'
  });
  /** 시작/해제 진행 중인 기기(버튼을 "연결 중…/해제 중…"으로 잠근다). */
  const [busy, setBusy] = useState<Record<string, 'starting' | 'stopping'>>({});
  const clearBusy = (id: string): void =>
    setBusy((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  const openWizard = (tab: 'android-usb' | 'ios-wifi'): void => setWizard({ open: true, tab });

  const handleStart = async (
    device: DeviceInfo,
    mode: AndroidInterceptionMode,
    trafficPath: AndroidTrafficPath
  ): Promise<void> => {
    setBusy((prev) => ({ ...prev, [device.id]: 'starting' }));
    try {
      const result = await withProgress(operationId.deviceStart(device.id), `${device.name} 연결 중`, () =>
        start(device, mode, trafficPath)
      );
      if (!interceptionStarted(device.platform, result)) {
        toast.warning('인터셉션을 시작하지 못했습니다', {
          description: result.warnings[0] ?? '기기 연결과 프록시 상태를 확인하세요.'
        });
      } else if (result.warnings.length > 0) {
        toast.warning('인터셉션 시작(주의 필요)', { description: result.warnings[0] });
      } else {
        toast.success('인터셉션 시작됨', { description: device.name });
      }
    } catch (e) {
      toast.error('인터셉션 실패', {
        description: e instanceof Error ? e.message : String(e)
      });
    } finally {
      clearBusy(device.id);
    }
  };

  const handleStop = async (device: DeviceInfo): Promise<void> => {
    setBusy((prev) => ({ ...prev, [device.id]: 'stopping' }));
    try {
      await withProgress(operationId.deviceStop(device.id), `${device.name} 해제 중`, () => stop(device));
      toast('인터셉션 해제됨', { description: device.name });
    } catch (e) {
      toast.error('인터셉션 해제 실패', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      clearBusy(device.id);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          기기
        </h3>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => openWizard('android-usb')}>
            <CircleHelp /> 연결 가이드
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
        clients.length > 0 ? (
          <p className="text-xs text-muted-foreground">USB로 감지된 기기가 없습니다(아래 접속 중인 기기는 프록시 기준).</p>
        ) : (
          <EmptyState
            compact
            icon={SmartphoneNfc}
            title="연결된 기기가 없습니다"
            description="Android는 USB 디버깅(ADB), iOS는 USB로 연결하면 자동 감지됩니다. Wi-Fi 프록시로 접속한 기기는 아래 '접속 중인 기기'에 나타납니다."
            action={
              <Button variant="outline" size="sm" onClick={() => openWizard('android-usb')}>
                <CircleHelp /> 연결 방법 보기
              </Button>
            }
          />
        )
      ) : (
        devices.map((device) => (
          <DeviceItem
            key={device.id}
            device={device}
            interception={interceptions[device.id]}
            busy={busy[device.id]}
            onStart={(mode, path) => void handleStart(device, mode, path)}
            onStop={() => void handleStop(device)}
            onIosSetup={() => openWizard('ios-wifi')}
          />
        ))
      )}

      <ClientList
        clients={clients}
        devices={devices}
        now={now}
        proxyRunning={proxyRunning}
        untrackedCount={untrackedCount}
        activeFilter={activeClientFilter}
        onFilter={(ip) => onFilterClient(activeClientFilter === ip ? undefined : ip)}
        onIosSetup={() => openWizard('ios-wifi')}
      />

      <ConnectionWizard
        open={wizard.open}
        onOpenChange={(open) => setWizard((w) => ({ ...w, open }))}
        initialTab={wizard.tab}
        input={{ proxyRunning, devices, interceptions, clients, now }}
      />
    </div>
  );
}
