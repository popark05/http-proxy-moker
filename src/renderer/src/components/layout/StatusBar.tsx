import type { ProxyStatus } from '@shared/capture';
import { cn } from '@/lib/utils';
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
  onOpenConnect
}: StatusBarProps): JSX.Element {
  const isMock = mode === 'mock';
  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-card/80 px-3 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className={cn('inline-block size-1.5 rounded-full', proxy.running ? 'bg-[hsl(var(--success))]' : 'bg-muted-foreground/50')} />
        {proxy.running ? `프록시 :${proxy.port} 수신 중` : '프록시 중지됨'}
      </span>
      <button type="button" onClick={onOpenConnect} className="hover:text-foreground">
        접속 기기 {clientCount}
      </button>
      <span className={cn(isMock && 'text-[hsl(var(--warning))]')}>{isMock ? '목킹 모드' : '캡처 모드'}</span>
      {isMock && (
        <span>
          목 {activeMockCount}개 활성
          {activeScenario ? ` · ${activeScenario}` : ''}
          {activeScenario && scenarioDirty ? ' · 수정됨' : ''}
        </span>
      )}
    </footer>
  );
}
