import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { ProxyStatus } from '@shared/capture';
import { Badge } from '@/components/ui/badge';
import { cn, restartAnimation } from '@/lib/utils';
import type { AppMode } from '../../state/app-mode';

interface StatusBarProps {
  proxy: ProxyStatus;
  mode: AppMode;
  /** 프록시에 접속한 기기 수. */
  clientCount: number;
  activeMockCount: number;
  activeScenario?: string;
  /** 활성 시나리오에서 작업 공간이 수정되었는가. */
  scenarioDirty?: boolean;
  /** 마지막 mock-hit 시각(활성 목 배지 pulse 트리거). */
  lastHitAt?: number;
  onOpenConnect: () => void;
}

/** 하단 상태바. 프록시·기기·목킹 상태를 항상 보여 준다. */
export function StatusBar({
  proxy,
  mode,
  clientCount,
  activeMockCount,
  activeScenario,
  scenarioDirty,
  lastHitAt,
  onOpenConnect
}: StatusBarProps): JSX.Element {
  const isMock = mode === 'mock';

  // mock-hit이 발생하면 활성 목 배지를 잠깐 pulse한다.
  const badgeRef = useRef<HTMLSpanElement>(null);
  const prevHit = useRef(lastHitAt ?? 0);
  useEffect(() => {
    if (lastHitAt && lastHitAt !== prevHit.current) {
      prevHit.current = lastHitAt;
      restartAnimation(badgeRef.current, 'animate-mock-hit-pulse');
    }
  }, [lastHitAt]);
  return (
    <footer
      aria-label="상태"
      className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-card/80 px-3 text-xs text-muted-foreground"
    >
      <span role="status" className="inline-flex items-center gap-1.5">
        <span
          className={cn(
            'inline-block size-1.5 rounded-full',
            proxy.running ? 'bg-[hsl(var(--success))]' : 'bg-muted-foreground/50'
          )}
        />
        {proxy.running ? `프록시 :${proxy.port} 수신 중` : '프록시 중지됨'}
      </span>
      <button
        type="button"
        onClick={onOpenConnect}
        className="rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        접속 기기 {clientCount}
      </button>
      <span className={cn(isMock && 'text-[hsl(var(--warning))]')}>{isMock ? '목킹 모드' : '캡처 모드'}</span>
      <span role="status" className="contents">
        {isMock &&
          (activeMockCount > 0 ? (
            <Badge ref={badgeRef} variant="warning" className="h-4 rounded-full px-2 py-0 text-2xs">
              목 {activeMockCount}개 활성
              {activeScenario ? ` · ${activeScenario}` : ''}
              {activeScenario && scenarioDirty ? ' · 수정됨' : ''}
            </Badge>
          ) : (
            <Badge variant="error" className="h-4 px-2 py-0 text-2xs">
              <AlertTriangle className="mr-1 size-3" />
              활성 목 없음 — 응답이 그대로 통과됩니다
            </Badge>
          ))}
      </span>
    </footer>
  );
}
