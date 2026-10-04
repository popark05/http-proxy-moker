import { describe, it, expect } from 'vitest';
import type { CapturedBody } from '../../src/shared/capture';
import { isHtmlText } from '../../src/shared/html-body';

const text = (content: string, contentType?: string): CapturedBody => ({
  encoding: 'text',
  content,
  byteLength: content.length,
  contentType
});

describe('isHtmlText', () => {
  it('content-type이 text/html이면 HTML', () => {
    expect(isHtmlText(text('<p>x</p>', 'text/html; charset=utf-8'))).toBe(true);
    expect(isHtmlText(text('<p/>', 'application/xhtml+xml'))).toBe(true);
  });

  it('content-type이 없거나 text/plain이면 doctype/<html> 시작일 때만 HTML로 추정', () => {
    expect(isHtmlText(text('  <!DOCTYPE html><html></html>'))).toBe(true);
    expect(isHtmlText(text('<html lang="ko">', 'text/plain'))).toBe(true);
    expect(isHtmlText(text('{"a":1}'))).toBe(false);
    expect(isHtmlText(text('plain text'))).toBe(false);
  });

  it('다른 형식으로 선언된 본문(JSON 등)은 내용이 HTML처럼 보여도 HTML이 아니다', () => {
    expect(isHtmlText(text('<html></html>', 'application/json'))).toBe(false);
  });

  it('텍스트가 아니면 HTML이 아니다', () => {
    expect(isHtmlText({ encoding: 'base64', content: 'PGh0bWw+', byteLength: 6, contentType: 'text/html' })).toBe(false);
  });
});
