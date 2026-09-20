import { Play, Square, Trash2 } from 'lucide-react';
import type { ProxyStatus } from '@shared/capture';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface ProxyControlsProps {
  status: ProxyStatus;
  count: number;
  onStart: () => void;
  onStop: () => void;
  onClear: () => void;
}

export function ProxyControls({
  status,
  count,
  onStart,
  onStop,
  onClear
}: ProxyControlsProps): JSX.Element {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      {status.running ? (
        <Button variant="destructive" size="sm" onClick={onStop}>
          <Square className="fill-current" /> 중지
        </Button>
      ) : (
        <Button size="sm" onClick={onStart}>
          <Play className="fill-current" /> 프록시 시작
        </Button>
      )}

      {status.running && (
        <Badge variant="success">
          <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-current" />
          :{status.port} 수신 중
        </Badge>
      )}

      <div className="flex-1" />

      <Badge variant="neutral">{count} 건</Badge>
      <Button variant="ghost" size="icon" onClick={onClear} aria-label="캡처 지우기">
        <Trash2 />
      </Button>
    </div>
  );
}
