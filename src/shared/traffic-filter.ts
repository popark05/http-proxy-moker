/**
 * 캡처 트래픽 필터링 순수 로직.
 * 자유 텍스트 검색(URL/헤더/본문) + 구조적 필터(메서드/상태클래스/호스트/태그).
 * renderer 밖에서도 테스트 가능하도록 순수 함수로 유지.
 */

import type { CapturedExchange } from './capture';

/** 상태 코드 분류(필터 칩용). */
export type StatusClass = '2xx' | '3xx' | '4xx' | '5xx' | 'pending' | 'error';

export interface TrafficFilter {
  /** URL/헤더/본문 자유 검색(대소문자 무시). */
  text?: string;
  /** 선택된 HTTP 메서드(대문자). 비어있으면 전체. */
  methods?: string[];
  /** 선택된 상태 클래스. 비어있으면 전체. */
  statusClasses?: StatusClass[];
  /** 호스트 부분 일치(대소문자 무시). */
  host?: string;
  /** 이 태그를 모두 가진 exchange만(AND). 비어있으면 전체. */
  tags?: string[];
}

/** exchange의 응답 상태를 StatusClass로 분류. */
export function statusClassOf(exchange: CapturedExchange): StatusClass {
  const { response } = exchange;
  if (response === 'aborted') return 'error';
  if (!response) return 'pending';
  const code = response.statusCode;
  if (code >= 500) return '5xx';
  if (code >= 400) return '4xx';
  if (code >= 300) return '3xx';
  if (code >= 200) return '2xx';
  return 'error';
}

/** exchange에서 호스트를 추출. */
export function hostOf(exchange: CapturedExchange): string {
  if (exchange.request.destination) {
    // "host:port" → host
    const [host] = exchange.request.destination.split(':');
    return host;
  }
  try {
    return new URL(exchange.request.url).hostname;
  } catch {
    return '';
  }
}

/** 자유 텍스트 검색 대상 문자열을 만든다(URL + 헤더 + text 본문). */
export function buildSearchIndex(exchange: CapturedExchange): string {
  const parts: string[] = [exchange.request.method, exchange.request.url];

  for (const [name, value] of exchange.request.headers) {
    parts.push(`${name}: ${value}`);
  }
  if (exchange.request.body.encoding === 'text') {
    parts.push(exchange.request.body.content);
  }

  const res = exchange.response;
  if (res && res !== 'aborted') {
    parts.push(String(res.statusCode), res.statusMessage);
    for (const [name, value] of res.headers) parts.push(`${name}: ${value}`);
    if (res.body.encoding === 'text') parts.push(res.body.content);
  }

  if (exchange.tags) parts.push(...exchange.tags);

  return parts.join('\n').toLowerCase();
}

/** 단일 exchange가 필터를 통과하는지. searchIndex는 성능을 위해 외부에서 주입 가능. */
export function matchesFilter(
  exchange: CapturedExchange,
  filter: TrafficFilter,
  searchIndex?: string
): boolean {
  // 텍스트
  if (filter.text && filter.text.trim()) {
    const idx = searchIndex ?? buildSearchIndex(exchange);
    if (!idx.includes(filter.text.trim().toLowerCase())) return false;
  }

  // 메서드
  if (filter.methods && filter.methods.length > 0) {
    if (!filter.methods.includes(exchange.request.method.toUpperCase())) return false;
  }

  // 상태 클래스
  if (filter.statusClasses && filter.statusClasses.length > 0) {
    if (!filter.statusClasses.includes(statusClassOf(exchange))) return false;
  }

  // 호스트
  if (filter.host && filter.host.trim()) {
    if (!hostOf(exchange).toLowerCase().includes(filter.host.trim().toLowerCase())) return false;
  }

  // 태그(AND)
  if (filter.tags && filter.tags.length > 0) {
    const tags = exchange.tags ?? [];
    if (!filter.tags.every((t) => tags.includes(t))) return false;
  }

  return true;
}

/** 필터가 하나라도 활성인지. */
export function isFilterActive(filter: TrafficFilter): boolean {
  return (
    !!filter.text?.trim() ||
    (filter.methods?.length ?? 0) > 0 ||
    (filter.statusClasses?.length ?? 0) > 0 ||
    !!filter.host?.trim() ||
    (filter.tags?.length ?? 0) > 0
  );
}

/** exchange 목록에 필터를 적용. 성능을 위해 검색 인덱스를 메모이즈하려면 indexCache를 넘긴다. */
export function applyFilter(
  exchanges: CapturedExchange[],
  filter: TrafficFilter,
  indexCache?: Map<string, string>
): CapturedExchange[] {
  if (!isFilterActive(filter)) return exchanges;
  return exchanges.filter((e) => {
    let idx = indexCache?.get(e.id);
    if (idx === undefined) {
      idx = buildSearchIndex(e);
      indexCache?.set(e.id, idx);
    }
    return matchesFilter(e, filter, idx);
  });
}

/** 현재 목록에서 사용 가능한 호스트 목록(중복 제거, 정렬). */
export function collectHosts(exchanges: CapturedExchange[]): string[] {
  const set = new Set<string>();
  for (const e of exchanges) {
    const h = hostOf(e);
    if (h) set.add(h);
  }
  return [...set].sort();
}

/** 현재 목록에서 사용 중인 태그 목록(중복 제거, 정렬). */
export function collectTags(exchanges: CapturedExchange[]): string[] {
  const set = new Set<string>();
  for (const e of exchanges) {
    for (const t of e.tags ?? []) set.add(t);
  }
  return [...set].sort();
}
