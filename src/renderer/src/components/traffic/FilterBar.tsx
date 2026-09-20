import { useState } from 'react';
import { Search, X, SlidersHorizontal } from 'lucide-react';
import type { TrafficFilter, StatusClass } from '@shared/traffic-filter';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Chip } from '../primitives';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;
const STATUS_CLASSES: StatusClass[] = ['2xx', '3xx', '4xx', '5xx', 'pending', 'error'];

interface FilterBarProps {
  filter: TrafficFilter;
  patchFilter: (patch: Partial<TrafficFilter>) => void;
  clearFilter: () => void;
  active: boolean;
  hosts: string[];
  tags: string[];
  total: number;
  shown: number;
}

/** toggle 배열에서 값을 추가/제거. */
function toggle<T>(arr: T[] | undefined, value: T): T[] {
  const list = arr ?? [];
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function FilterBar({
  filter,
  patchFilter,
  clearFilter,
  active,
  hosts,
  tags,
  total,
  shown
}: FilterBarProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-1.5 border-b border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <Input
          className="h-8"
          placeholder="URL · 헤더 · 본문 검색"
          value={filter.text ?? ''}
          onChange={(e) => patchFilter({ text: e.target.value })}
          aria-label="트래픽 검색"
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label="필터 펼치기"
          onClick={() => setExpanded((v) => !v)}
          className="size-8"
        >
          <SlidersHorizontal />
        </Button>
        {active && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="필터 초기화"
            onClick={clearFilter}
            className="size-8"
          >
            <X />
          </Button>
        )}
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {shown} / {total}
        </span>
      </div>

      {expanded && (
        <div className="flex flex-col gap-1.5 pt-1">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">메서드</span>
            {METHODS.map((m) => (
              <Chip
                key={m}
                $active={filter.methods?.includes(m) ?? false}
                onClick={() => patchFilter({ methods: toggle(filter.methods, m) })}
              >
                {m}
              </Chip>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">상태</span>
            {STATUS_CLASSES.map((s) => (
              <Chip
                key={s}
                $active={filter.statusClasses?.includes(s) ?? false}
                onClick={() => patchFilter({ statusClasses: toggle(filter.statusClasses, s) })}
              >
                {s}
              </Chip>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">호스트</span>
            <select
              value={filter.host ?? ''}
              onChange={(e) => patchFilter({ host: e.target.value || undefined })}
              aria-label="호스트 필터"
              className="rounded-md border border-input bg-transparent px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">전체</option>
              {hosts.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>

          {tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-xs text-muted-foreground">태그</span>
              {tags.map((t) => (
                <Chip
                  key={t}
                  $active={filter.tags?.includes(t) ?? false}
                  onClick={() => patchFilter({ tags: toggle(filter.tags, t) })}
                >
                  {t}
                </Chip>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
