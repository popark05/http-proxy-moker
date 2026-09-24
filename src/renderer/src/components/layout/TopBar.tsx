import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Radio, FlaskConical, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn, restartAnimation } from '@/lib/utils';
import { LogoWordmark } from '../brand/Logo';
import { CaExportModal } from '../cert/CaExportModal';
import { useAppMode } from '../../state/app-mode';

interface TopBarProps {
  /** 활성(enabled) 목 개수. */
  activeMockCount: number;
  /** 현재 활성 시나리오명. */
  activeScenario?: string;
  /** 마지막 mock-hit 시각(pulse 트리거). */
  lastHitAt?: number;
}

/**
 * 상단 바. macOS 신호등 공간 확보 + 드래그 영역.
 * 현재 모드(캡처/목킹)를 색과 아이콘으로 강하게 구분해 QA가 착각하지 않도록 한다.
 * 목킹 모드에서는 활성 목/시나리오를 상시 표시하고, 활성 목이 없으면 경고한다.
 */
export function TopBar({ activeMockCount, activeScenario, lastHitAt }: TopBarProps): JSX.Element {
  const { mode, setMode } = useAppMode();
  const [caOpen, setCaOpen] = useState(false);
  const isMock = mode === 'mock';

  // mock-hit 발생 시 활성 목 배지를 잠깐 pulse.
  const badgeRef = useRef<HTMLSpanElement>(null);
  const prevHit = useRef(lastHitAt ?? 0);
  useEffect(() => {
    if (lastHitAt && lastHitAt !== prevHit.current) {
      prevHit.current = lastHitAt;
      restartAnimation(badgeRef.current, 'animate-mock-hit-pulse');
    }
  }, [lastHitAt]);

  return (
    <header
      className={cn(
        'flex items-center gap-4 border-b border-b-2 bg-card/80 pl-[84px] pr-4 backdrop-blur',
        isMock ? 'border-b-[hsl(var(--warning))]' : 'border-b-primary'
      )}
      style={{ height: 52, WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <LogoWordmark />

      {/* 모드 세그먼트 토글 */}
      <div
        className="ml-2 flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          type="button"
          onClick={() => setMode('capture')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            !isMock
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Radio className="size-3.5" /> 캡처
        </button>
        <button
          type="button"
          onClick={() => setMode('mock')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            isMock
              ? 'bg-[hsl(var(--warning)/0.18)] text-[hsl(var(--warning))]'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <FlaskConical className="size-3.5" /> 목킹
        </button>
      </div>

      {/* 목킹 모드 상태 표시 */}
      {isMock && (
        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {activeMockCount > 0 ? (
            <Badge ref={badgeRef} variant="warning" className="rounded-full">
              목 {activeMockCount}개 활성
              {activeScenario ? ` · ${activeScenario}` : ''}
            </Badge>
          ) : (
            <Badge variant="error">
              <AlertTriangle className="mr-1 size-3" />
              활성 목 없음 — 응답이 그대로 통과됩니다
            </Badge>
          )}
        </div>
      )}

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
