/**
 * Bruno 컬렉션(.bru) 내보내기/가져오기.
 *
 * .bru는 Bruno의 공개된 파일 형식이다. 이 파일은 형식 문서를 보고 직접 구현했고 Bruno 소스를 복사하지 않았다.
 * 내보내기: 계약 → 요청 .bru(assert로 상태 코드, tests로 응답 모양 전체 검증) + 환경 파일 + bruno.json.
 *   tests 안에 계약의 기대값(expectation)을 JSON으로 함께 넣어 두어, EverMock으로 다시 가져오면 그대로 복원된다.
 * 가져오기: 요청 .bru → 계약. 우리가 내보낸 파일이면 기대값을 복원하고, 그 밖의 파일은 assert(상태 코드, 간단한 타입 검사)만 읽는다.
 */

import {
  isSafeMethod,
  requiredVariables,
  type Contract,
  type ContractServer,
  type FieldRule,
  type JsonShape
} from './contract';

export interface BrunoFile {
  /** 컬렉션 폴더 기준 상대 경로. */
  path: string;
  content: string;
}

const STANDARD_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
const EXPECTATION_MARKER = 'const expectation = ';

function indent(text: string, spaces = 2): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? pad + line : line))
    .join('\n');
}

/** 파일 이름으로 쓸 수 있게 다듬는다. */
export function brunoFileName(name: string): string {
  const cleaned = name.normalize('NFC').replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/\s+/g, ' ').trim();
  return cleaned || 'untitled';
}

// ---------- tests 블록에 넣는 모양 검증기 ----------

/** Bruno tests(JS)에서 실행되는 모양 검증기. shared/contract.ts의 validateShape와 같은 규칙. */
const VALIDATOR_JS = `function norm(p) { return p.replace(/\\[\\d+\\]/g, '[]'); }
function kind(v) { return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v; }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function check(v, s, p, rules, out) {
  var r = rules[norm(p)];
  if (r) {
    if (r.mode === 'ignore') return;
    if (r.mode === 'equals') { if (!same(v, r.value)) out.push(p + ': ' + JSON.stringify(r.value) + ' 이어야 함 (실제: ' + JSON.stringify(v) + ')'); return; }
  }
  if (s.kind === 'any') return;
  if (s.kind === 'union') {
    var ok = s.of.some(function (m) { var o = []; check(v, m, p, rules, o); return o.length === 0; });
    if (!ok) out.push(p + ': 타입이 맞지 않음 (실제: ' + kind(v) + ')');
    return;
  }
  if (s.kind === 'array') {
    if (!Array.isArray(v)) { out.push(p + ': array 이어야 함 (실제: ' + kind(v) + ')'); return; }
    v.forEach(function (x, i) { check(x, s.items, p + '[' + i + ']', rules, out); });
    return;
  }
  if (s.kind === 'object') {
    if (kind(v) !== 'object') { out.push(p + ': object 이어야 함 (실제: ' + kind(v) + ')'); return; }
    s.required.forEach(function (k) {
      var rr = rules[norm(p + '.' + k)];
      if (rr && rr.mode === 'ignore') return;
      if (!(k in v)) out.push(p + '.' + k + ': 필수 필드가 없음');
    });
    Object.keys(s.props).forEach(function (k) { if (k in v) check(v[k], s.props[k], p + '.' + k, rules, out); });
    return;
  }
  if (kind(v) !== s.kind) out.push(p + ': ' + s.kind + ' 이어야 함 (실제: ' + kind(v) + ')');
}`;

/** 검증기를 단독 함수로 만든다(테스트용: 내보낸 JS가 validateShape와 같게 동작하는지 확인). */
export function buildBrunoShapeChecker(): (value: unknown, shape: JsonShape, rules: Record<string, FieldRule>) => string[] {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`${VALIDATOR_JS}\nreturn function (v, s, rules) { var out = []; check(v, s, '$', rules, out); return out; };`)() as ReturnType<
    typeof buildBrunoShapeChecker
  >;
}

function testsBlock(contract: Contract): string {
  const { bodyShape, fieldRules, headers } = contract.expect;
  const expectation = JSON.stringify({ headers, bodyShape: bodyShape ?? null, fieldRules: fieldRules ?? {} });
  const lines = [
    `test("응답이 계약과 같다", function () {`,
    `  ${EXPECTATION_MARKER}${expectation};`,
    ...VALIDATOR_JS.split('\n').map((l) => `  ${l}`),
    `  expectation.headers.forEach(function (h) {`,
    `    expect(res.getHeader(h), h + ' 응답 헤더').to.not.equal(undefined);`,
    `  });`,
    `  if (expectation.bodyShape) {`,
    `    var out = [];`,
    `    check(res.getBody(), expectation.bodyShape, '$', expectation.fieldRules, out);`,
    `    expect(out, out.join('\\n')).to.have.lengthOf(0);`,
    `  }`,
    `});`
  ];
  return lines.join('\n');
}

// ---------- 내보내기 ----------

function contractToBru(contract: Contract, seq: number): string {
  const { request, expect: exp } = contract;
  const method = request.method.toLowerCase();
  const standard = STANDARD_METHODS.has(method);
  const body = request.body && request.body.encoding === 'text' ? request.body : undefined;
  const ct = (body?.contentType ?? '').toLowerCase();
  const bodyKind = !body ? undefined : ct.includes('json') ? 'json' : ct.includes('xml') ? 'xml' : ct.includes('x-www-form-urlencoded') ? 'formUrlEncoded' : 'text';

  let bru = `meta {\n  name: ${contract.name}\n  type: http\n  seq: ${seq}\n}\n\n`;
  bru += standard ? `${method} {\n` : `http {\n  method: ${request.method}\n`;
  bru += `  url: ${request.urlTemplate}\n  body: ${bodyKind ?? 'none'}\n  auth: none\n}\n\n`;

  if (request.query.length > 0) {
    bru += `params:query {\n${request.query.map(([k, v]) => `  ${k}: ${v}`).join('\n')}\n}\n\n`;
  }
  const headers = request.headers.filter(([n]) => n.toLowerCase() !== 'content-type' || !body);
  const allHeaders = body?.contentType ? [...headers, ['Content-Type', body.contentType] as [string, string]] : headers;
  if (allHeaders.length > 0) {
    bru += `headers {\n${allHeaders.map(([k, v]) => `  ${k}: ${v}`).join('\n')}\n}\n\n`;
  }
  if (body && bodyKind) {
    const block = bodyKind === 'formUrlEncoded' ? 'body:form-urlencoded' : `body:${bodyKind}`;
    const content =
      bodyKind === 'formUrlEncoded'
        ? [...new URLSearchParams(body.content).entries()].map(([k, v]) => `${k}: ${v}`).join('\n')
        : bodyKind === 'json'
          ? safePretty(body.content)
          : body.content;
    bru += `${block} {\n${indent(content)}\n}\n\n`;
  }

  const asserts =
    typeof exp.status === 'number'
      ? [`res.status: eq ${exp.status}`]
      : [`res.status: gte ${exp.status.min}`, `res.status: lte ${exp.status.max}`];
  bru += `assert {\n${asserts.map((a) => `  ${a}`).join('\n')}\n}\n\n`;
  bru += `tests {\n${indent(testsBlock(contract))}\n}\n`;
  return bru;
}

function safePretty(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

function envFile(vars: Record<string, string>, secrets: string[]): string {
  const entries = Object.entries(vars);
  let out = `vars {\n${entries.map(([k, v]) => `  ${k}: ${v}`).join('\n')}\n}\n`;
  if (secrets.length > 0) out += `\nvars:secret [\n${secrets.map((s) => `  ${s}`).join(',\n')}\n]\n`;
  return out;
}

/**
 * 계약들을 Bruno 컬렉션 파일 목록으로 만든다.
 * 환경: 등록한 서버마다 하나, 캡처한 서버(origin)마다 하나. 토큰 같은 변수는 값 없이 secret으로만 선언한다.
 */
export function exportBrunoCollection(name: string, contracts: Contract[], servers: ContractServer[]): BrunoFile[] {
  const files: BrunoFile[] = [
    { path: 'bruno.json', content: JSON.stringify({ version: '1', name, type: 'collection' }, null, 2) + '\n' }
  ];
  const used = new Set<string>();
  contracts.forEach((contract, i) => {
    // 서버(호스트)별 폴더로 나눠 Bruno 사이드바에서 한눈에 보이게 한다.
    const host = contract.source?.origin ? brunoFileName(new URL(contract.source.origin).host.replace(/:/g, '_')) : '';
    const dir = host ? `${host}/` : '';
    let base = brunoFileName(contract.name);
    for (let n = 2; used.has(`${dir}${base}`.toLowerCase()); n++) base = `${brunoFileName(contract.name)} (${n})`;
    used.add(`${dir}${base}`.toLowerCase());
    files.push({ path: `${dir}${base}.bru`, content: contractToBru(contract, i + 1) });
  });

  const secrets = requiredVariables(contracts);
  for (const server of servers) {
    files.push({ path: `environments/${brunoFileName(server.name)}.bru`, content: envFile({ baseUrl: server.baseUrl }, secrets) });
  }
  const origins = [...new Set(contracts.flatMap((c) => (c.source?.origin ? [c.source.origin] : [])))].sort();
  for (const origin of origins) {
    const host = new URL(origin).host.replace(/[:.]/g, '_');
    files.push({ path: `environments/captured-${host}.bru`, content: envFile({ baseUrl: origin }, secrets) });
  }
  return files;
}

// ---------- 가져오기 ----------

/** .bru 텍스트를 블록 이름 → 본문 줄(들여쓰기 제거)로 나눈다. `name { ... }`와 `name [ ... ]` 형식을 읽는다. */
export function parseBruBlocks(text: string): Record<string, string[]> {
  const blocks: Record<string, string[]> = {};
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const open = /^([A-Za-z][\w:-]*)\s*([{[])\s*$/.exec(lines[i]);
    if (!open) continue;
    const close = open[2] === '{' ? '}' : ']';
    const body: string[] = [];
    for (i++; i < lines.length && lines[i] !== close; i++) body.push(lines[i].replace(/^ {2}/, ''));
    blocks[open[1]] = body;
  }
  return blocks;
}

/** `key: value` 줄들(비활성 `~key`는 제외). */
function keyValues(lines: string[] | undefined): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const line of lines ?? []) {
    const m = /^([^:]+?):\s?(.*)$/.exec(line.trim());
    if (m && !m[1].startsWith('~') && !m[1].startsWith('@')) out.push([m[1].trim(), m[2]]);
  }
  return out;
}

const TYPE_ASSERT: Record<string, JsonShape> = {
  isNumber: { kind: 'number' },
  isString: { kind: 'string' },
  isBoolean: { kind: 'boolean' },
  isNull: { kind: 'null' },
  isArray: { kind: 'array', items: { kind: 'any' } },
  isJson: { kind: 'object', props: {}, required: [] }
};

/** `res.body.a.b: isNumber` 같은 단순 경로 assert를 응답 모양으로 합친다. 못 읽는 assert 줄 수를 함께 돌려준다. */
function shapeFromAsserts(asserts: Array<[string, string]>): { shape?: JsonShape; unread: number } {
  let root: Extract<JsonShape, { kind: 'object' }> | undefined;
  let unread = 0;
  for (const [key, value] of asserts) {
    const m = /^res\.body\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/.exec(key);
    const leaf = TYPE_ASSERT[value.trim()];
    if (!m || !leaf) {
      if (!/^res\.status$/.test(key)) unread++;
      continue;
    }
    root ??= { kind: 'object', props: {}, required: [] };
    const parts = m[1].split('.');
    let node = root;
    parts.forEach((part, idx) => {
      if (!node.required.includes(part)) node.required.push(part);
      if (idx === parts.length - 1) {
        node.props[part] = leaf;
      } else {
        const next = node.props[part];
        if (next?.kind === 'object') node = next;
        else {
          const created: Extract<JsonShape, { kind: 'object' }> = { kind: 'object', props: {}, required: [] };
          node.props[part] = created;
          node = created;
        }
      }
    });
  }
  return { shape: root, unread };
}

export interface BrunoImportResult {
  contract: Contract | null;
  /** 읽지 못하고 건너뛴 항목 설명(요청이 아니거나 지원하지 않는 부분). */
  notes: string[];
}

/** 요청 .bru 하나를 계약으로 바꾼다. 요청이 아닌 파일(collection.bru, 환경 등)은 contract가 null. */
export function brunoToContract(text: string, fallbackName: string, id: string): BrunoImportResult {
  const blocks = parseBruBlocks(text);
  const methodKey = Object.keys(blocks).find((k) => STANDARD_METHODS.has(k) || k === 'http');
  if (!methodKey) return { contract: null, notes: [] };

  const notes: string[] = [];
  const head = Object.fromEntries(keyValues(blocks[methodKey]));
  const method = (methodKey === 'http' ? head.method : methodKey)?.toUpperCase();
  if (!method || !head.url) return { contract: null, notes: ['메서드나 주소가 없어 건너뜀'] };

  // 주소: 절대 주소면 origin을 떼어 낸다. 앞의 {{변수}}는 {{baseUrl}}로 통일한다.
  let urlTemplate = head.url;
  let origin: string | undefined;
  const queryFromUrl: Array<[string, string]> = [];
  const abs = /^(https?:\/\/[^/?#]+)(.*)$/i.exec(urlTemplate);
  if (abs) {
    origin = abs[1];
    urlTemplate = `{{baseUrl}}${abs[2]}`;
  } else {
    urlTemplate = urlTemplate.replace(/^\{\{\s*[\w.-]+\s*\}\}/, '{{baseUrl}}');
  }
  const q = urlTemplate.indexOf('?');
  if (q >= 0) {
    for (const [k, v] of new URLSearchParams(urlTemplate.slice(q + 1)).entries()) queryFromUrl.push([k, v]);
    urlTemplate = urlTemplate.slice(0, q);
  }
  const path = urlTemplate.replace(/^\{\{baseUrl\}\}/, '') || '/';

  const bodyKey = Object.keys(blocks).find((k) => k.startsWith('body:'));
  let body: Contract['request']['body'];
  if (bodyKey) {
    const type = bodyKey.slice(5);
    const content = blocks[bodyKey].join('\n');
    if (type === 'json') body = { encoding: 'text', content, contentType: 'application/json' };
    else if (type === 'xml') body = { encoding: 'text', content, contentType: 'application/xml' };
    else if (type === 'text') body = { encoding: 'text', content, contentType: 'text/plain' };
    else if (type === 'form-urlencoded') {
      body = {
        encoding: 'text',
        content: new URLSearchParams(keyValues(blocks[bodyKey])).toString(),
        contentType: 'application/x-www-form-urlencoded'
      };
    } else notes.push(`${bodyKey} 본문은 지원하지 않아 제외`);
  }

  const asserts = keyValues(blocks.assert);
  let status: Contract['expect']['status'] = 200;
  const min = asserts.find(([k, v]) => k === 'res.status' && /^gte\s/.test(v));
  const max = asserts.find(([k, v]) => k === 'res.status' && /^lte\s/.test(v));
  const eq = asserts.find(([k, v]) => k === 'res.status' && /^eq\s/.test(v));
  if (eq) status = Number(eq[1].replace(/^eq\s+/, '')) || 200;
  else if (min && max) status = { min: Number(min[1].replace(/^gte\s+/, '')), max: Number(max[1].replace(/^lte\s+/, '')) };
  else notes.push('상태 코드 assert가 없어 200으로 가정');

  // 우리가 내보낸 파일이면 기대값을 그대로 복원한다.
  let expectation: { headers: string[]; bodyShape: JsonShape | null; fieldRules: Record<string, FieldRule> } | undefined;
  const marker = (blocks.tests ?? []).find((l) => l.includes(EXPECTATION_MARKER));
  if (marker) {
    try {
      const jsonText = marker.slice(marker.indexOf(EXPECTATION_MARKER) + EXPECTATION_MARKER.length).replace(/;\s*$/, '');
      expectation = JSON.parse(jsonText);
    } catch {
      notes.push('기대값을 읽지 못해 assert만 사용');
    }
  }
  let bodyShape: JsonShape | undefined;
  if (expectation) {
    bodyShape = expectation.bodyShape ?? undefined;
  } else {
    const parsed = shapeFromAsserts(asserts);
    bodyShape = parsed.shape;
    if (parsed.unread > 0) notes.push(`지원하지 않는 assert ${parsed.unread}개 제외`);
    if (blocks.tests?.length) notes.push('tests 스크립트는 가져오지 않음');
  }

  const meta = Object.fromEntries(keyValues(blocks.meta));
  const name = (meta.name || fallbackName).trim();
  const fieldRules = expectation?.fieldRules ?? {};
  const contract: Contract = {
    version: 1,
    id,
    endpointId: `${method} ${path}`,
    name,
    source: { capturedAt: Date.now(), ...(origin ? { origin } : {}) },
    request: {
      method,
      urlTemplate: `{{baseUrl}}${path}`,
      query: [...queryFromUrl, ...keyValues(blocks['params:query'])],
      headers: keyValues(blocks.headers).filter(([n]) => !(body && n.toLowerCase() === 'content-type')),
      ...(body ? { body } : {})
    },
    expect: {
      status,
      headers: expectation?.headers ?? [],
      ...(bodyShape ? { bodyShape } : {}),
      ...(Object.keys(fieldRules).length > 0 ? { fieldRules } : {})
    },
    verifiable: typeof status === 'number' ? status < 500 : status.max < 500,
    safeToRun: isSafeMethod(method)
  };
  return { contract, notes };
}
