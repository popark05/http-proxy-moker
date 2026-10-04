import type { CapturedExchange } from './capture';
import { pathWithoutQuery } from './mock-convert';
import { hostOf } from './traffic-filter';

/** 같은 호스트 안에서 method+path(쿼리 제외)가 같은 요청 묶음. 목은 이 단위로 하나만 의미가 있다. */
export interface EndpointGroup {
  /** `METHOD /path` (호스트 안에서 유일). */
  key: string;
  method: string;
  path: string;
  /** 캡처 순서(오래된 것 → 최신). */
  exchanges: CapturedExchange[];
  /** 가장 최근 호출. 목 복제/상세의 기본 대상. */
  latest: CapturedExchange;
}

export interface HostGroup {
  host: string;
  endpoints: EndpointGroup[];
  /** 이 호스트의 모든 exchange(캡처 순서). */
  exchanges: CapturedExchange[];
  /** 4xx/5xx 응답 또는 중단된 요청 수. */
  errorCount: number;
}

/** 목록에 그릴 한 줄. */
export type TrafficRow =
  | { kind: 'host'; group: HostGroup; collapsed: boolean }
  | { kind: 'endpoint'; host: string; endpoint: EndpointGroup; expanded: boolean }
  | { kind: 'call'; host: string; endpoint: EndpointGroup; exchange: CapturedExchange };

export function isErrorExchange(exchange: CapturedExchange): boolean {
  const r = exchange.response;
  return r === 'aborted' || (!!r && r.statusCode >= 400);
}

/**
 * 호스트 → method+path 순으로 묶는다. 호스트/엔드포인트 순서는 처음 등장한 순서를 유지해서
 * 새 요청이 들어와도 목록이 뒤섞이지 않는다.
 */
export function groupTraffic(exchanges: CapturedExchange[]): HostGroup[] {
  const hosts = new Map<string, HostGroup>();
  const endpointIndex = new Map<string, EndpointGroup>();

  for (const exchange of exchanges) {
    const host = hostOf(exchange) || '(알 수 없음)';
    let group = hosts.get(host);
    if (!group) {
      group = { host, endpoints: [], exchanges: [], errorCount: 0 };
      hosts.set(host, group);
    }
    group.exchanges.push(exchange);
    if (isErrorExchange(exchange)) group.errorCount++;

    const method = exchange.request.method.toUpperCase();
    const path = pathWithoutQuery(exchange.request.url);
    const key = `${method} ${path}`;
    const indexKey = `${host}\n${key}`;
    let endpoint = endpointIndex.get(indexKey);
    if (!endpoint) {
      endpoint = { key, method, path, exchanges: [], latest: exchange };
      endpointIndex.set(indexKey, endpoint);
      group.endpoints.push(endpoint);
    }
    endpoint.exchanges.push(exchange);
    endpoint.latest = exchange;
  }
  return [...hosts.values()];
}

/** 엔드포인트 펼침 상태를 저장하는 키(호스트가 달라도 같은 method+path가 있으므로 호스트를 포함). */
export function endpointStateKey(host: string, endpoint: EndpointGroup): string {
  return `${host}\n${endpoint.key}`;
}

/**
 * 그룹을 가상 목록용 평면 행으로 펼친다.
 * 접힌 호스트는 헤더만, 펼침 표시된 엔드포인트(호출 2회 이상)는 개별 호출을 최신순으로 보여준다.
 */
export function flattenRows(
  groups: HostGroup[],
  collapsedHosts: ReadonlySet<string>,
  expandedEndpoints: ReadonlySet<string>
): TrafficRow[] {
  const rows: TrafficRow[] = [];
  for (const group of groups) {
    const collapsed = collapsedHosts.has(group.host);
    rows.push({ kind: 'host', group, collapsed });
    if (collapsed) continue;
    for (const endpoint of group.endpoints) {
      const expanded =
        endpoint.exchanges.length > 1 && expandedEndpoints.has(endpointStateKey(group.host, endpoint));
      rows.push({ kind: 'endpoint', host: group.host, endpoint, expanded });
      if (expanded) {
        for (const exchange of [...endpoint.exchanges].reverse()) {
          rows.push({ kind: 'call', host: group.host, endpoint, exchange });
        }
      }
    }
  }
  return rows;
}

export type CheckState = 'all' | 'some' | 'none';

/** ids 중 체크된 비율에 따른 체크박스 상태. */
export function checkStateOf(ids: readonly string[], checked: ReadonlySet<string>): CheckState {
  let n = 0;
  for (const id of ids) if (checked.has(id)) n++;
  return n === 0 ? 'none' : n === ids.length ? 'all' : 'some';
}
