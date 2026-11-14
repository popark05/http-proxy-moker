import { Circle, Pause, Trash2 } from 'lucide-react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';

interface CaptureControlsProps {
  /** true면 새 요청을 목록에 쌓지 않는다. */
  paused: boolean;
  onTogglePaused: () => void;
  count: number;
  onClear: () => void;
  /** 저장된 캡처를 보는 중에는 지울 실시간 목록이 화면에 없으므로 막는다. */
  clearDisabled?: boolean;
}

/**
 * 트래픽 기록 컨트롤. 프록시를 켜고 끄는 대신(프록시는 자동으로 켜진다) "지금 들어오는 요청을 목록에 쌓을지"만 다룬다.
 * 일시중지해도 기기의 통신은 그대로 통과한다.
 */
export function CaptureControls({ paused, onTogglePaused, count, onClear, clearDisabled }: CaptureControlsProps): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <Button
        label={paused ? '일시중지됨 · 재개' : '기록 중 · 일시중지'}
        icon={
          paused ? (
            <Icon icon={Circle} className="fill-[hsl(var(--warning))] text-[hsl(var(--warning))]" />
          ) : (
            <Icon icon={Pause} />
          )
        }
        variant={paused ? 'secondary' : 'ghost'}
        size="sm"
        aria-pressed={paused}
        tooltip={paused ? '기록을 다시 시작합니다' : '새 요청을 목록에 쌓지 않습니다(기기 통신은 그대로 통과)'}
        onClick={onTogglePaused}
      />

      <div className="flex-1" />

      <Badge variant="neutral" label={`${count} 건`} />
      <IconButton
        label="캡처 지우기"
        icon={<Icon icon={Trash2} />}
        variant="ghost"
        tooltip={clearDisabled ? '저장된 캡처를 보는 중에는 지울 수 없습니다' : undefined}
        onClick={onClear}
        isDisabled={clearDisabled}
      />
    </div>
  );
}
