import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, Radio } from 'lucide-react';
import type { CapturedExchange } from '@shared/capture';
import {
  checkStateOf,
  endpointStateKey,
  flattenRows,
  groupTraffic,
  type CheckState,
  type TrafficRow
} from '@shared/traffic-group';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '../common/EmptyState';
import { methodTone, statusTone } from '../primitives';
import { cn } from '@/lib/utils';

interface TrafficGroupListProps {
  exchanges: CapturedExchange[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  checkedIds: ReadonlySet<string>;
  onCheckedChange: (next: Set<string>) => void;
}

/** 일부만 체크된 상태(indeterminate)를 표시하는 체크박스. */
function TriCheckbox({
  state,
  label,
  onToggle
}: {
  state: CheckState;
  label: string;
  onToggle: () => void;
}): JSX.Element {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={state === 'all'}
      ref={(el) => {
        if (el) el.indeterminate = state === 'some';
      }}
      onChange={() => {}}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="size-4 shrink-0 cursor-pointer accent-[hsl(var(--primary))]"
    />
  );
}

function StatusBadge({ exchange }: { exchange: CapturedExchange }): JSX.Element {
  const r = exchange.response;
  if (r === 'aborted') return <Badge variant="error">✕</Badge>;
  if (r) return <Badge variant={statusTone(r.statusCode)}>{r.statusCode}</Badge>;
  return <Badge variant="neutral">…</Badge>;
}

const ROW_HEIGHT: Record<TrafficRow['kind'], number> = { host: 36, endpoint: 44, call: 36 };

/**
 * 호스트별 접이식 그룹 + 같은 method+path 묶음(×N) 목록.
 * 엔드포인트 행을 누르면 최신 호출이 상세에 열리고, 체크박스는 묶음 전체(모든 호출)를 선택한다
 * (일괄 복제는 method+path당 최신 응답 하나만 만든다).
 */
export function TrafficGroupList({
  exchanges,
  selectedId,
  onSelect,
  checkedIds,
  onCheckedChange
}: TrafficGroupListProps): JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null);
  const [collapsedHosts, setCollapsedHosts] = useState<Set<string>>(new Set());
  const [expandedEndpoints, setExpandedEndpoints] = useState<Set<string>>(new Set());

  const groups = useMemo(() => groupTraffic(exchanges), [exchanges]);
  const rows = useMemo(
    () => flattenRows(groups, collapsedHosts, expandedEndpoints),
    [groups, collapsedHosts, expandedEndpoints]
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => ROW_HEIGHT[rows[i].kind],
    overscan: 12
  });

  const toggleSet = <T,>(set: Set<T>, value: T, update: (next: Set<T>) => void): void => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
  };

  /** ids 전체를 체크/해제(하나라도 안 켜져 있으면 모두 켠다). */
  const toggleIds = (ids: readonly string[]): void => {
    const next = new Set(checkedIds);
    const allChecked = checkStateOf(ids, checkedIds) === 'all';
    for (const id of ids) {
      if (allChecked) next.delete(id);
      else next.add(id);
    }
    onCheckedChange(next);
  };

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
          const row = rows[item.index];
          return (
            <div
              key={rowKey(row)}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start}px)`
              }}
            >
              {row.kind === 'host' ? (
                <div className="flex h-9 items-center gap-2 border-b border-border bg-muted/40 px-3">
                  <TriCheckbox
                    state={checkStateOf(row.group.exchanges.map((e) => e.id), checkedIds)}
                    label={`${row.group.host} 전체 선택`}
                    onToggle={() => toggleIds(row.group.exchanges.map((e) => e.id))}
                  />
                  <button
                    type="button"
                    onClick={() => toggleSet(collapsedHosts, row.group.host, setCollapsedHosts)}
                    aria-expanded={!row.collapsed}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  >
                    {row.collapsed ? (
                      <ChevronRight className="size-4 shrink-0" />
                    ) : (
                      <ChevronDown className="size-4 shrink-0" />
                    )}
                    <span className="truncate font-mono text-sm font-medium" title={row.group.host}>
                      {row.group.host}
                    </span>
                  </button>
                  {row.group.errorCount > 0 && (
                    <Badge variant="error" title="4xx/5xx 또는 중단된 요청">
                      ⚠ {row.group.errorCount}
                    </Badge>
                  )}
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {row.group.exchanges.length}건
                  </span>
                </div>
              ) : row.kind === 'endpoint' ? (
                <EndpointRow
                  row={row}
                  selectedId={selectedId}
                  checkedIds={checkedIds}
                  onSelect={onSelect}
                  onToggleChecked={() => toggleIds(row.endpoint.exchanges.map((e) => e.id))}
                  onToggleExpanded={() =>
                    toggleSet(
                      expandedEndpoints,
                      endpointStateKey(row.host, row.endpoint),
                      setExpandedEndpoints
                    )
                  }
                />
              ) : (
                <div
                  className={cn(
                    'flex h-9 items-center gap-2 border-b border-border pl-10 pr-3 transition-colors',
                    row.exchange.id === selectedId ? 'bg-accent' : 'hover:bg-accent/50'
                  )}
                >
                  <TriCheckbox
                    state={checkedIds.has(row.exchange.id) ? 'all' : 'none'}
                    label="이 호출 선택"
                    onToggle={() => toggleIds([row.exchange.id])}
                  />
                  <button
                    type="button"
                    onClick={() => onSelect(row.exchange.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
                      title={row.exchange.request.url}
                    >
                      {callLabel(row.exchange)}
                    </span>
                    <StatusBadge exchange={row.exchange} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function rowKey(row: TrafficRow): string {
  if (row.kind === 'host') return `h:${row.group.host}`;
  if (row.kind === 'endpoint') return `e:${endpointStateKey(row.host, row.endpoint)}`;
  return `c:${row.exchange.id}`;
}

/** 호출 한 줄 라벨: 쿼리 스트링(없으면 "(쿼리 없음)"). */
function callLabel(exchange: CapturedExchange): string {
  try {
    const search = new URL(exchange.request.url).search;
    return search || '(쿼리 없음)';
  } catch {
    return exchange.request.url;
  }
}

function EndpointRow({
  row,
  selectedId,
  checkedIds,
  onSelect,
  onToggleChecked,
  onToggleExpanded
}: {
  row: Extract<TrafficRow, { kind: 'endpoint' }>;
  selectedId: string | undefined;
  checkedIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onToggleChecked: () => void;
  onToggleExpanded: () => void;
}): JSX.Element {
  const { endpoint, expanded } = row;
  const count = endpoint.exchanges.length;
  const ids = endpoint.exchanges.map((e) => e.id);
  const selected = selectedId !== undefined && ids.includes(selectedId);
  const state = checkStateOf(ids, checkedIds);
  return (
    <div
      className={cn(
        'flex h-11 items-center gap-2 border-b border-border pl-6 pr-3 transition-colors',
        selected ? 'bg-accent' : state !== 'none' ? 'bg-accent/40' : 'hover:bg-accent/50'
      )}
    >
      <TriCheckbox state={state} label={`${endpoint.key} 선택`} onToggle={onToggleChecked} />
      <button
        type="button"
        onClick={(e) =>
          // Cmd/Ctrl+클릭은 상세 이동 없이 체크만 토글(목록 선택과 같은 관례).
          e.metaKey || e.ctrlKey ? onToggleChecked() : onSelect(endpoint.latest.id)
        }
        className="grid min-w-0 flex-1 grid-cols-[52px_1fr_auto] items-center gap-2 text-left"
      >
        <Badge variant={methodTone(endpoint.method)}>{endpoint.method}</Badge>
        <span
          className="truncate font-mono text-sm text-muted-foreground"
          title={endpoint.latest.request.url}
        >
          {endpoint.path}
        </span>
        <StatusBadge exchange={endpoint.latest} />
      </button>
      {count > 1 && (
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-label={`${count}번 호출 ${expanded ? '접기' : '펼치기'}`}
          title="이 요청의 호출 내역"
          className="flex shrink-0 items-center gap-0.5 rounded-sm px-1 text-xs text-muted-foreground hover:bg-accent"
        >
          ×{count}
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
      )}
    </div>
  );
}
