import { describe, it, expect } from 'vitest';
import type { CapturedBody } from '../../src/shared/capture';
import { isHtmlText, looksLikeSpaShell } from '../../src/shared/html-body';

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

describe('looksLikeSpaShell', () => {
  it('CRA 같은 SPA 껍데기(보이는 글자가 noscript뿐)를 감지', () => {
    const shell =
      '<!doctype html><html><head><title>App</title><script defer src="/main.js"></script></head>' +
      '<body><noscript>You need to enable JavaScript to run this app.</noscript><div id="root"></div></body></html>';
    expect(looksLikeSpaShell(shell)).toBe(true);
  });

  it('실제 내용이 있는 HTML이나 스크립트가 없는 빈 문서는 껍데기가 아니다', () => {
    expect(looksLikeSpaShell('<html><body><h1>안녕</h1><script>1</script></body></html>')).toBe(false);
    expect(looksLikeSpaShell('<html><body></body></html>')).toBe(false);
  });
});
