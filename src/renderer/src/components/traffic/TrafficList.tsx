import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { CapturedExchange } from '@shared/capture';
import { Badge } from '@/components/ui/badge';
import { methodTone, statusTone } from '../primitives';
import { cn } from '@/lib/utils';

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

interface TrafficListProps {
  exchanges: CapturedExchange[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}

/** 캡처된 트래픽 목록. @tanstack/react-virtual로 대량 렌더 최적화. */
export function TrafficList({ exchanges, selectedId, onSelect }: TrafficListProps): JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: exchanges.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (exchanges[index]?.tags?.length ? 60 : 44),
    overscan: 12
  });

  if (exchanges.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        아직 캡처된 요청이 없습니다. 프록시를 시작하고 트래픽을 보내보세요.
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const exchange = exchanges[item.index];
          const response = exchange.response;
          const selected = exchange.id === selectedId;
          return (
            <div
              key={exchange.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start}px)`
              }}
            >
              <button
                type="button"
                onClick={() => onSelect(exchange.id)}
                className={cn(
                  'grid w-full grid-cols-[56px_1fr_52px] items-center gap-2 border-b border-border px-3 py-2 text-left transition-colors',
                  selected ? 'bg-accent' : 'hover:bg-accent/50'
                )}
              >
                <Badge variant={methodTone(exchange.request.method)}>
                  {exchange.request.method}
                </Badge>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span
                    title={exchange.request.url}
                    className="truncate font-mono text-sm text-muted-foreground"
                  >
                    {shortUrl(exchange.request.url)}
                  </span>
                  {exchange.tags && exchange.tags.length > 0 && (
                    <div className="flex gap-1 overflow-hidden">
                      {exchange.tags.map((t) => (
                        <span
                          key={t}
                          className="whitespace-nowrap rounded-sm bg-muted px-1 font-mono text-2xs leading-tight text-muted-foreground"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {response === 'aborted' ? (
                  <Badge variant="error">✕</Badge>
                ) : response ? (
                  <Badge variant={statusTone(response.statusCode)}>{response.statusCode}</Badge>
                ) : (
                  <Badge variant="neutral">…</Badge>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
