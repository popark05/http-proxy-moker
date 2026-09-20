import { useState } from 'react';
import styled from 'styled-components';
import { AndroidLogo, AppleLogo, ArrowsClockwise } from '@phosphor-icons/react';
import type {
  AndroidInterceptionMode,
  DeviceInfo,
  InterceptionResult
} from '@shared/device';
import { Button, Badge } from '../primitives';
import { useDevices } from '../../state/useDevices';
import { IosSetupModal } from './IosSetupModal';

const ModeSelect = styled.select`
  background: ${({ theme }) => theme.panelRaisedBackground};
  color: ${({ theme }) => theme.primaryText};
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: 2px ${({ theme }) => theme.space.xs};
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
`;

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space.sm};
`;

const Head = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const HeadTitle = styled.h3`
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: ${({ theme }) => theme.mutedText};
`;

const DeviceRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.sm};
  padding: ${({ theme }) => theme.space.sm};
  border: 1px solid ${({ theme }) => theme.borderSubtle};
  border-radius: ${({ theme }) => theme.radii.md};
`;

const DeviceName = styled.div`
  flex: 1;
  min-width: 0;
`;

const Name = styled.div`
  font-size: ${({ theme }) => theme.fontSizes.input};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Warnings = styled.ul`
  margin-top: ${({ theme }) => theme.space.xs};
  padding-left: ${({ theme }) => theme.space.lg};
  list-style: disc;
  color: ${({ theme }) => theme.statusWarning};
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
  line-height: 1.5;
`;

const Empty = styled.div`
  color: ${({ theme }) => theme.mutedText};
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
  padding: ${({ theme }) => theme.space.sm};
`;

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
    // CA 미설치: HTTPS 복호화 불가(root 주입 실패 등).
    return { tone: 'warning', text: `${prefix}HTTP만 (HTTPS 복호화 불가)` };
  }

  if (result.usedMode === 'vpn') {
    // VPN(non-root): 유저 CA를 신뢰하는 앱에 한해 HTTPS 복호화.
    return { tone: 'success', text: `${prefix}HTTPS 복호화 (유저 CA 신뢰 앱)` };
  }

  // root: 시스템 CA 주입 → 모든 앱 HTTPS 복호화.
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
    <div>
      <DeviceRow>
        {isIos ? <AppleLogo size={18} /> : <AndroidLogo size={18} />}
        <DeviceName>
          <Name title={device.id}>{device.name}</Name>
        </DeviceName>
        <Badge $tone={statusTone(device.status)}>{device.status}</Badge>

        {!isIos && !active && (
          <ModeSelect
            aria-label="인터셉션 방식"
            value={mode}
            onChange={(e) => setMode(e.target.value as AndroidInterceptionMode)}
          >
            <option value="auto">자동</option>
            <option value="root">시스템 CA (root)</option>
            <option value="vpn">VPN (non-root)</option>
          </ModeSelect>
        )}

        {isIos ? (
          <Button $variant="secondary" $size="sm" onClick={onIosSetup}>
            셋업 가이드
          </Button>
        ) : active ? (
          <Button $variant="danger" $size="sm" onClick={onStop}>
            해제
          </Button>
        ) : (
          <Button
            $variant="primary"
            $size="sm"
            disabled={device.status !== 'ready'}
            onClick={() => onStart(mode)}
          >
            인터셉트
          </Button>
        )}
      </DeviceRow>
      {active && !isIos && (
        <Badge $tone={interceptionBadge(interception!).tone}>
          {interceptionBadge(interception!).text}
        </Badge>
      )}
      {interception && interception.warnings.length > 0 && (
        <Warnings>
          {interception.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </Warnings>
      )}
    </div>
  );
}

export function DevicePanel(): JSX.Element {
  const { devices, refreshing, refresh, interceptions, start, stop } = useDevices();
  const [iosSetupOpen, setIosSetupOpen] = useState(false);

  return (
    <Wrap>
      <Head>
        <HeadTitle>기기</HeadTitle>
        <div style={{ display: 'flex', gap: 4 }}>
          <Button $variant="ghost" $size="sm" onClick={() => setIosSetupOpen(true)}>
            <AppleLogo size={14} /> iOS 셋업
          </Button>
          <Button
            $variant="ghost"
            $size="sm"
            aria-label="기기 새로고침"
            onClick={() => void refresh()}
          >
            <ArrowsClockwise size={14} /> {refreshing ? '검색 중' : '새로고침'}
          </Button>
        </div>
      </Head>

      {devices.length === 0 ? (
        <Empty>연결된 기기가 없습니다. Android는 ADB로, iOS는 USB로 연결하세요.</Empty>
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
    </Wrap>
  );
}
