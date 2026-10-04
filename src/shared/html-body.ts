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
