import type { ComponentProps, ReactNode } from 'react';
import { DevicePanel } from '../device/DevicePanel';
import { ProxyControls } from '../traffic/ProxyControls';

interface LeftColumnProps {
  proxyProps: ComponentProps<typeof ProxyControls>;
  deviceProps: ComponentProps<typeof DevicePanel>;
  /** 남는 높이를 쓰는 트래픽 패널. */
  children: ReactNode;
}

/** 좌측 컬럼(프록시 컨트롤 + 기기 + 트래픽). 캡처/목킹 모드 공용: 목킹에서도 프록시 시작과 기기 연결이 필요하다. */
export function LeftColumn({ proxyProps, deviceProps, children }: LeftColumnProps): JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <ProxyControls {...proxyProps} />
      {/* 기기 패널은 줄어들지 않는다(shrink-0). 낮은 창에서는 트래픽 리스트가 남는 높이만큼만 쓴다. */}
      <div className="max-h-[50%] shrink-0 overflow-auto border-b border-border px-4 py-2">
        <DevicePanel {...deviceProps} />
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
