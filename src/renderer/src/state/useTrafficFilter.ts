import { useMemo, useRef, useState } from 'react';
import type { CapturedExchange } from '@shared/capture';
import {
  applyFilter,
  collectHosts,
  collectTags,
  isFilterActive,
  type TrafficFilter
} from '@shared/traffic-filter';

interface UseTrafficFilterResult {
  filter: TrafficFilter;
  setFilter: (filter: TrafficFilter) => void;
  patchFilter: (patch: Partial<TrafficFilter>) => void;
  clearFilter: () => void;
  /** 필터가 적용된 exchange 목록. */
  filtered: CapturedExchange[];
  /** 현재 목록에서 파생된 호스트/태그 옵션. */
  hosts: string[];
  tags: string[];
  active: boolean;
  /** 특정 exchange의 검색 인덱스 캐시를 무효화(태그/내용 변경 시). */
  invalidateIndex: (id: string) => void;
}

const EMPTY: TrafficFilter = {};

/** 트래픽 필터 상태 + 파생 목록을 관리하는 훅. */
export function useTrafficFilter(exchanges: CapturedExchange[]): UseTrafficFilterResult {
  const [filter, setFilter] = useState<TrafficFilter>(EMPTY);
  // 검색 인덱스 캐시(exchange id → 인덱스). 대량 목록에서 재계산 방지.
  const indexCache = useRef(new Map<string, string>());

  const filtered = useMemo(
    () => applyFilter(exchanges, filter, indexCache.current),
    [exchanges, filter]
  );

  const hosts = useMemo(() => collectHosts(exchanges), [exchanges]);
  const tags = useMemo(() => collectTags(exchanges), [exchanges]);

  const patchFilter = (patch: Partial<TrafficFilter>): void =>
    setFilter((prev) => ({ ...prev, ...patch }));
  const clearFilter = (): void => setFilter(EMPTY);
  const invalidateIndex = (id: string): void => {
    indexCache.current.delete(id);
  };

  return {
    filter,
    setFilter,
    patchFilter,
    clearFilter,
    filtered,
    hosts,
    tags,
    active: isFilterActive(filter),
    invalidateIndex
  };
}
