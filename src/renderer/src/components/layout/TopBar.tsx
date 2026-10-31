import { useState } from 'react';
import { ShieldCheck, Radio, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { LogoWordmark } from '../brand/Logo';
import { CaExportModal } from '../cert/CaExportModal';
import { useAppMode } from '../../state/app-mode';

/**
 * 상단 바. macOS 신호등 공간 확보 + 드래그 영역.
 * "목 적용" 스위치와 상단 선 색으로 목 적용 여부를 강하게 구분해 QA가 착각하지 않도록 한다.
 * 내부 값은 모드(capture|mock)이고, "프록시가 목을 적용하는가"만 바꾸는 전역 설정이다. 목 상태(활성 개수, 시나리오)는 하단 상태바가 보여 준다.
 */
export function TopBar(): JSX.Element {
  const { mode, setMode } = useAppMode();
  const [caOpen, setCaOpen] = useState(false);
  const isMock = mode === 'mock';

  return (
    <header
      className={cn(
        'flex items-center gap-4 border-b border-b-2 bg-card/80 pl-4 pr-4 [[data-platform=darwin]_&]:pl-[84px] [[data-platform=win32]_&]:pr-[150px] backdrop-blur',
        isMock ? 'border-b-[hsl(var(--warning))]' : 'border-b-primary'
      )}
      style={{ height: 52, WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <LogoWordmark />

      {/* 목 적용 스위치: 켜면 프록시가 목으로 응답하고, 끄면 실제 서버 응답을 그대로 캡처한다. */}
      <label
        className="ml-2 flex cursor-pointer items-center gap-2 text-xs font-medium"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Switch
          checked={isMock}
          onCheckedChange={(on) => setMode(on ? 'mock' : 'capture')}
          aria-label="목 적용"
          className="data-[state=checked]:bg-[hsl(var(--warning))]"
        />
        <span className={cn('inline-flex items-center gap-1.5', isMock ? 'text-[hsl(var(--warning))]' : 'text-muted-foreground')}>
          {isMock ? <FlaskConical className="size-3.5" /> : <Radio className="size-3.5" />}
          {isMock ? '목 적용 중' : '목 적용 꺼짐 · 실제 응답 캡처'}
        </span>
      </label>

      <div className="flex-1" />

      <div
        className="flex items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Button variant="ghost" size="sm" aria-label="CA 인증서" onClick={() => setCaOpen(true)}>
          <ShieldCheck className="size-4" /> CA
        </Button>
      </div>

      <CaExportModal open={caOpen} onOpenChange={setCaOpen} />
    </header>
  );
}
