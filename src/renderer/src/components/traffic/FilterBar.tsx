import { useState } from 'react';
import { Search, X, SlidersHorizontal } from 'lucide-react';
import type { TrafficFilter, StatusClass } from '@shared/traffic-filter';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { ToggleButton } from '@astryxdesign/core/ToggleButton';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Selector } from '@astryxdesign/core/Selector';

/** 필터를 지정하지 않는 선택지("전체")의 값. */
const ALL = '__all__';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;
const STATUS_CLASSES: StatusClass[] = ['2xx', '3xx', '4xx', '5xx', 'pending', 'error'];

interface FilterBarProps {
  filter: TrafficFilter;
  patchFilter: (patch: Partial<TrafficFilter>) => void;
  clearFilter: () => void;
  active: boolean;
  hosts: string[];
  tags: string[];
  /** 접속 기기 선택지(기기가 둘 이상일 때만 필터를 보여준다). */
  clients: Array<{ ip: string; label: string }>;
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
  clients,
  total,
  shown
}: FilterBarProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-1.5 border-b border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <TextInput
          label="트래픽 검색"
          isLabelHidden
          size="sm"
          startIcon={Search}
          containerClassName="flex-1"
          placeholder="URL · 헤더 · 본문 검색"
          value={filter.text ?? ''}
          onChange={(v) => patchFilter({ text: v })}
        />
        <IconButton
          label="필터 펼치기"
          icon={<Icon icon={SlidersHorizontal} />}
          variant="ghost"
          onClick={() => setExpanded((v) => !v)}
          className="size-8"
        />
        {active && (
          <IconButton
            label="필터 초기화"
            icon={<Icon icon={X} />}
            variant="ghost"
            onClick={clearFilter}
            className="size-8"
          />
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
              <ToggleButton key={m} label={m} size="sm" isPressed={filter.methods?.includes(m) ?? false} onPressedChange={() => patchFilter({ methods: toggle(filter.methods, m) })} />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">상태</span>
            {STATUS_CLASSES.map((s) => (
              <ToggleButton key={s} label={s} size="sm" isPressed={filter.statusClasses?.includes(s) ?? false} onPressedChange={() => patchFilter({ statusClasses: toggle(filter.statusClasses, s) })} />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <Selector
              label="호스트 필터"
              size="sm"
              variant="secondary"
              value={filter.host ?? ALL}
              options={[{ value: ALL, label: '전체' }, ...hosts.map((h) => ({ value: h, label: h }))]}
              onChange={(v) => patchFilter({ host: v === ALL ? undefined : v })}
            />
          </div>

          {(clients.length > 1 || !!filter.client) && (
            <div className="flex flex-wrap items-center gap-1">
              <Selector
                label="기기 필터"
                size="sm"
                variant="secondary"
                value={filter.client ?? ALL}
                options={[{ value: ALL, label: '전체' }, ...clients.map((c) => ({ value: c.ip, label: `${c.label} (${c.ip})` }))]}
                onChange={(v) => patchFilter({ client: v === ALL ? undefined : v })}
              />
            </div>
          )}

          {tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-xs text-muted-foreground">태그</span>
              {tags.map((t) => (
                <ToggleButton key={t} label={t} size="sm" isPressed={filter.tags?.includes(t) ?? false} onPressedChange={() => patchFilter({ tags: toggle(filter.tags, t) })} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
