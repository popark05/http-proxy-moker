import type { CapturedRequest } from './capture';

/** 작은따옴표로 감싸 셸이 해석하지 않게 한다. */
function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** curl이 알아서 정하는 헤더는 뺀다(복사한 명령이 그대로 돌게). */
const SKIP_HEADERS = new Set(['host', 'content-length', 'connection', 'accept-encoding']);

/** 캡처된 요청을 cURL 명령으로 만든다. 본문은 텍스트일 때만 넣는다. */
export function toCurl(request: CapturedRequest): string {
  const parts = ['curl', '-X', request.method.toUpperCase(), shellQuote(request.url)];
  for (const [name, value] of request.headers) {
    if (SKIP_HEADERS.has(name.toLowerCase())) continue;
    parts.push('-H', shellQuote(`${name}: ${value}`));
  }
  if (request.body.encoding === 'text' && request.body.content) {
    parts.push('--data-raw', shellQuote(request.body.content));
  }
  return parts.join(' ');
}
