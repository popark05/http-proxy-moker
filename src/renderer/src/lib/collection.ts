import { isSafeMethod, listVariables, uniqueContractName, type Contract, type ContractRequest } from '@shared/contract';

/** 편집기에서 URL 한 줄로 보여 주는 값: `{{baseUrl}}/users?page=2`. */
export function urlTextOf(request: ContractRequest): string {
  if (request.query.length === 0) return request.urlTemplate;
  const qs = request.query.map(([k, v]) => `${k}=${v}`).join('&');
  return `${request.urlTemplate}${request.urlTemplate.includes('?') ? '&' : '?'}${qs}`;
}

/** URL 한 줄 입력을 주소 템플릿과 쿼리로 나눈다. `{{var}}` 값은 그대로 둔다. */
export function applyUrlText(request: ContractRequest, text: string): ContractRequest {
  const at = text.indexOf('?');
  if (at < 0) return { ...request, urlTemplate: text.trim(), query: [] };
  const query = text
    .slice(at + 1)
    .split('&')
    .filter(Boolean)
    .map((pair): [string, string] => {
      const eq = pair.indexOf('=');
      return eq < 0 ? [pair, ''] : [pair.slice(0, eq), pair.slice(eq + 1)];
    });
  return { ...request, urlTemplate: text.slice(0, at).trim(), query };
}

/** 헤더 편집용 텍스트(`이름: 값` 한 줄씩). */
export const headersToText = (headers: ReadonlyArray<[string, string]>): string =>
  headers.map(([k, v]) => `${k}: ${v}`).join('\n');

export function textToHeaders(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim();
    if (name) out.push([name, line.slice(i + 1).trim()]);
  }
  return out;
}

/** 요청이 바뀌었으면 안전 여부도 메서드에 맞춰 다시 정한다(GET/HEAD/OPTIONS만 안전). */
export function withRequest(contract: Contract, request: ContractRequest): Contract {
  return { ...contract, request, safeToRun: isSafeMethod(request.method) };
}

/** 빈 요청. 서버는 실행할 때 고른다. */
export function newRequest(existingNames: string[], id: string): Contract {
  const name = uniqueContractName(existingNames, '새 요청');
  return {
    version: 1,
    id,
    endpointId: 'GET /',
    name,
    request: { method: 'GET', urlTemplate: '{{baseUrl}}/', query: [], headers: [] },
    expect: { status: { min: 200, max: 299 }, headers: [] },
    verifiable: true,
    safeToRun: true
  };
}

export interface ServerFolder {
  /** 캡처한 서버(origin). 출처가 없는 요청은 빈 문자열. */
  origin: string;
  items: Contract[];
}

/** 서버(origin)별 폴더로 묶는다. 폴더는 주소순, 출처 없는 요청은 맨 뒤. */
export function groupByServer(contracts: readonly Contract[]): ServerFolder[] {
  const map = new Map<string, Contract[]>();
  for (const c of contracts) {
    const origin = c.source?.origin ?? '';
    map.set(origin, [...(map.get(origin) ?? []), c]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([origin, items]) => ({ origin, items: [...items].sort((x, y) => x.name.localeCompare(y.name)) }));
}

/** 보낼 때 값을 입력받아야 하는 변수(baseUrl 제외). */
export function variablesOf(contract: Contract): string[] {
  const r = contract.request;
  const texts = [r.urlTemplate, ...r.query.flat(), ...r.headers.map(([, v]) => v), r.body?.content ?? ''];
  return [...new Set(texts.flatMap((t) => listVariables(t)))].filter((v) => v !== 'baseUrl').sort();
}
