import type { CapturedBody } from './capture';

/** <img>로 안전하게 표시할 수 있는 이미지 MIME(SVG는 <img> 안에서는 스크립트가 실행되지 않는다). */
const DISPLAYABLE = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/avif',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/svg+xml'
]);

/** content-type 헤더에서 MIME만 소문자로 뽑는다("image/PNG; charset=x" → "image/png"). */
export function mimeOf(contentType: string | undefined): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase();
}

/** base64 앞부분(매직 넘버)으로 이미지 형식을 추정한다. content-type이 없거나 부정확할 때를 위한 보정. */
export function sniffImageMime(base64: string): string | undefined {
  const head = base64.slice(0, 24);
  if (head.startsWith('iVBORw0KGgo')) return 'image/png';
  if (head.startsWith('/9j/')) return 'image/jpeg';
  if (head.startsWith('R0lGOD')) return 'image/gif';
  // RIFF + 4바이트 크기 + "WEBP": base64 위치가 정렬되지 않으므로 앞 12바이트를 디코딩해 확인한다.
  if (head.startsWith('UklGR')) {
    const bytes = atob(base64.slice(0, 16));
    if (bytes.slice(8, 12) === 'WEBP') return 'image/webp';
  }
  if (head.startsWith('Qk')) return 'image/bmp';
  return undefined;
}

/**
 * 본문이 화면에 그릴 수 있는 이미지면 그 MIME을, 아니면 undefined.
 * 선언된 content-type이 표시 가능한 이미지면 그것을 쓰고, 아니면 매직 넘버로 추정한다.
 */
export function displayableImageMime(body: CapturedBody): string | undefined {
  if (body.encoding !== 'base64') return undefined;
  const declared = mimeOf(body.contentType);
  if (DISPLAYABLE.has(declared)) return declared;
  // 이미지가 아니라고 선언된 본문(application/json 등)은 건드리지 않고, 형식이 모호할 때만 추정한다.
  if (declared === '' || declared === 'application/octet-stream' || declared.startsWith('image/')) {
    return sniffImageMime(body.content);
  }
  return undefined;
}

export function isSvgText(body: CapturedBody): boolean {
  return body.encoding === 'text' && mimeOf(body.contentType) === 'image/svg+xml';
}

/** <img src>에 넣을 data URL. */
export function toDataUrl(mime: string, content: string, encoding: 'base64' | 'text'): string {
  return encoding === 'base64'
    ? `data:${mime};base64,${content}`
    : `data:${mime};charset=utf-8,${encodeURIComponent(content)}`;
}
