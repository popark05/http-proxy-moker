import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Radio } from 'lucide-react';
import type { CapturedExchange } from '@shared/capture';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '../common/EmptyState';
import { methodTone, statusTone } from '../primitives';
import { cn } from '@/lib/utils';
import type { ClientPlatform } from '@shared/clients';
import { PlatformIcon } from '../device/ClientList';

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
  /** 체크(다중 선택)된 id 집합. 생략하면 체크박스를 표시하지 않는다. */
  checkedIds?: ReadonlySet<string>;
  onCheckedChange?: (next: Set<string>) => void;
  /** 접속 IP → 플랫폼. 기기가 둘 이상일 때 행에 기기 아이콘을 보여준다. */
  clientPlatforms?: ReadonlyMap<string, ClientPlatform>;
}

/** 캡처된 트래픽 목록. @tanstack/react-virtual로 대량 렌더 최적화. */
export function TrafficList({
  exchanges,
  selectedId,
  onSelect,
  checkedIds,
  onCheckedChange,
  clientPlatforms
}: TrafficListProps): JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null);
  /** Shift+클릭 범위 선택의 기준 행(목록 인덱스). */
  const anchorRef = useRef<number | undefined>(undefined);

  /** index 행의 체크를 토글. shift면 기준 행부터 index까지 같은 상태로 맞춘다. */
  const toggleChecked = (index: number, shift: boolean): void => {
    if (!checkedIds || !onCheckedChange) return;
    const next = new Set(checkedIds);
    const willCheck = !checkedIds.has(exchanges[index].id);
    const anchor = anchorRef.current;
    const [from, to] =
      shift && anchor !== undefined && anchor < exchanges.length
        ? [Math.min(anchor, index), Math.max(anchor, index)]
        : [index, index];
    for (let i = from; i <= to; i++) {
      if (willCheck) next.add(exchanges[i].id);
      else next.delete(exchanges[i].id);
    }
    anchorRef.current = index;
    onCheckedChange(next);
  };


  const virtualizer = useVirtualizer({
    count: exchanges.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (exchanges[index]?.tags?.length ? 60 : 44),
    overscan: 12
  });

  if (exchanges.length === 0) {
    return (
      <EmptyState
        icon={Radio}
        title="아직 캡처된 요청이 없습니다"
        description="프록시를 시작하고 기기 인터셉션을 켠 뒤, 앱에서 트래픽을 발생시키면 여기에 표시됩니다."
      />
    );
  }

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const exchange = exchanges[item.index];
          const response = exchange.response;
          const selected = exchange.id === selectedId;
          const checked = checkedIds?.has(exchange.id) ?? false;
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
              <div
                className={cn(
                  'flex items-center border-b border-border transition-colors',
                  selected ? 'bg-accent' : checked ? 'bg-accent/40' : 'hover:bg-accent/50'
                )}
              >
                {checkedIds && (
                  <label className="flex shrink-0 cursor-pointer items-center self-stretch pl-3 pr-1">
                    <input
                      type="checkbox"
                      aria-label="복제할 요청 선택"
                      checked={checked}
                      // onChange에는 shiftKey가 없어서 click 이벤트에서 처리한다.
                      onChange={() => {}}
                      onClick={(e) => toggleChecked(item.index, e.shiftKey)}
                      className="size-4 cursor-pointer accent-[hsl(var(--primary))]"
                    />
                  </label>
                )}
              <button
                type="button"
                onClick={(e) =>
                  // Cmd/Ctrl+클릭은 상세 이동 없이 체크만 토글(파일 탐색기와 같은 관례).
                  e.metaKey || e.ctrlKey ? toggleChecked(item.index, false) : onSelect(exchange.id)
                }
                className="grid min-w-0 flex-1 grid-cols-[56px_1fr_52px] items-center gap-2 px-3 py-2 text-left"
              >
                <Badge variant={methodTone(exchange.request.method)}>
                  {exchange.request.method}
                </Badge>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span
                    title={exchange.request.url}
                    className="flex items-center gap-1 truncate font-mono text-sm text-muted-foreground"
                  >
                    {clientPlatforms && clientPlatforms.size > 1 && exchange.request.clientIp && (
                      <PlatformIcon
                        platform={clientPlatforms.get(exchange.request.clientIp) ?? 'unknown'}
                        className="size-3.5 shrink-0"
                      />
                    )}
                    <span className="truncate">{shortUrl(exchange.request.url)}</span>
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
