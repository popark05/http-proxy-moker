import { Circle, Pause, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface CaptureControlsProps {
  /** true면 새 요청을 목록에 쌓지 않는다. */
  paused: boolean;
  onTogglePaused: () => void;
  count: number;
  onClear: () => void;
}

/**
 * 트래픽 기록 컨트롤. 프록시를 켜고 끄는 대신(프록시는 자동으로 켜진다) "지금 들어오는 요청을 목록에 쌓을지"만 다룬다.
 * 일시중지해도 기기의 통신은 그대로 통과한다.
 */
export function CaptureControls({ paused, onTogglePaused, count, onClear }: CaptureControlsProps): JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <Button
        variant={paused ? 'outline' : 'ghost'}
        size="sm"
        aria-pressed={paused}
        title={paused ? '기록을 다시 시작합니다' : '새 요청을 목록에 쌓지 않습니다(기기 통신은 그대로 통과)'}
        onClick={onTogglePaused}
      >
        {paused ? (
          <>
            <Circle className="fill-[hsl(var(--warning))] text-[hsl(var(--warning))]" /> 일시중지됨 · 재개
          </>
        ) : (
          <>
            <Pause /> 기록 중 · 일시중지
          </>
        )}
      </Button>

      <div className="flex-1" />

      <Badge variant="neutral">{count} 건</Badge>
      <Button variant="ghost" size="icon" onClick={onClear} aria-label="캡처 지우기">
        <Trash2 />
      </Button>
    </div>
  );
}
