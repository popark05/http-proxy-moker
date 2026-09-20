import { useState } from 'react';
import styled from 'styled-components';
import { MagnifyingGlass, X, FunnelSimple } from '@phosphor-icons/react';
import type { TrafficFilter, StatusClass } from '@shared/traffic-filter';
import { Chip, Button } from '../primitives';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space.xs};
  padding: ${({ theme }) => `${theme.space.sm} ${theme.space.md}`};
  border-bottom: 1px solid ${({ theme }) => theme.borderSubtle};
`;

const SearchRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.sm};
`;

const SearchInput = styled.input`
  flex: 1;
  min-width: 0;
  background: ${({ theme }) => theme.panelRaisedBackground};
  color: ${({ theme }) => theme.primaryText};
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.space.xs} ${theme.space.sm}`};
  font-size: ${({ theme }) => theme.fontSizes.input};
`;

const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${({ theme }) => theme.space.xs};
`;

const RowLabel = styled.span`
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
  color: ${({ theme }) => theme.mutedText};
  margin-right: ${({ theme }) => theme.space.xs};
`;

const Count = styled.span`
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
  color: ${({ theme }) => theme.secondaryText};
  white-space: nowrap;
`;

const Select = styled.select`
  background: ${({ theme }) => theme.panelRaisedBackground};
  color: ${({ theme }) => theme.primaryText};
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: 2px ${({ theme }) => theme.space.xs};
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
`;

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
    <Wrap>
      <SearchRow>
        <MagnifyingGlass size={14} />
        <SearchInput
          placeholder="URL · 헤더 · 본문 검색"
          value={filter.text ?? ''}
          onChange={(e) => patchFilter({ text: e.target.value })}
          aria-label="트래픽 검색"
        />
        <Button
          $variant="ghost"
          $size="sm"
          aria-label="필터 펼치기"
          onClick={() => setExpanded((v) => !v)}
        >
          <FunnelSimple size={14} />
        </Button>
        {active && (
          <Button $variant="ghost" $size="sm" aria-label="필터 초기화" onClick={clearFilter}>
            <X size={14} />
          </Button>
        )}
        <Count>
          {shown} / {total}
        </Count>
      </SearchRow>

      {expanded && (
        <>
          <ChipRow>
            <RowLabel>메서드</RowLabel>
            {METHODS.map((m) => (
              <Chip
                key={m}
                $active={filter.methods?.includes(m) ?? false}
                onClick={() => patchFilter({ methods: toggle(filter.methods, m) })}
              >
                {m}
              </Chip>
            ))}
          </ChipRow>

          <ChipRow>
            <RowLabel>상태</RowLabel>
            {STATUS_CLASSES.map((s) => (
              <Chip
                key={s}
                $active={filter.statusClasses?.includes(s) ?? false}
                onClick={() => patchFilter({ statusClasses: toggle(filter.statusClasses, s) })}
              >
                {s}
              </Chip>
            ))}
          </ChipRow>

          <ChipRow>
            <RowLabel>호스트</RowLabel>
            <Select
              value={filter.host ?? ''}
              onChange={(e) => patchFilter({ host: e.target.value || undefined })}
              aria-label="호스트 필터"
            >
              <option value="">전체</option>
              {hosts.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </Select>
          </ChipRow>

          {tags.length > 0 && (
            <ChipRow>
              <RowLabel>태그</RowLabel>
              {tags.map((t) => (
                <Chip
                  key={t}
                  $active={filter.tags?.includes(t) ?? false}
                  onClick={() => patchFilter({ tags: toggle(filter.tags, t) })}
                >
                  {t}
                </Chip>
              ))}
            </ChipRow>
          )}
        </>
      )}
    </Wrap>
  );
}
