import type { CapturedBody } from './capture';
import { mimeOf } from './image-body';

/** 본문이 HTML 문서인지. content-type을 우선하고, 없을 때만 doctype/<html> 시작으로 추정한다. */
export function isHtmlText(body: CapturedBody): boolean {
  if (body.encoding !== 'text') return false;
  const mime = mimeOf(body.contentType);
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return true;
  if (mime !== '' && mime !== 'text/plain') return false;
  return /^\s*(<!doctype\s+html|<html[\s>])/i.test(body.content.slice(0, 200));
}

/**
 * JS가 화면을 그리는 SPA 껍데기인지 추정한다: 스크립트/스타일/noscript/주석/태그를 걷어낸 뒤 보이는 글자가 없고,
 * 스크립트나 noscript가 있으면 껍데기로 본다. 정적 렌더링(스크립트 미실행)으로는 내용이 보이지 않는 HTML이다.
 */
export function looksLikeSpaShell(html: string): boolean {
  if (!/<script[\s>]|<noscript[\s>]/i.test(html)) return false;
  const visible = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|head|template)[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|\s+/gi, '');
  return visible.length === 0;
}
