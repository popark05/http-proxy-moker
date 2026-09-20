import { useState } from 'react';
import { ShieldCheck, Radio, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { LogoWordmark } from '../brand/Logo';
import { CaExportModal } from '../cert/CaExportModal';
import { useAppMode } from '../../state/app-mode';

/**
 * 상단 바. macOS 신호등 공간 확보 + 드래그 영역.
 * 현재 모드(캡처/목킹)를 색과 아이콘으로 강하게 구분해 QA가 착각하지 않도록 한다.
 */
export function TopBar(): JSX.Element {
  const { mode, setMode } = useAppMode();
  const [caOpen, setCaOpen] = useState(false);
  const isMock = mode === 'mock';

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
