import { describe, it, expect } from 'vitest';
import { toCurl } from '../../src/shared/curl';
import type { CapturedRequest } from '../../src/shared/capture';

const req = (over: Partial<CapturedRequest> = {}): CapturedRequest => ({
  method: 'post',
  url: 'https://api.example.com/login?x=1',
  path: '/login?x=1',
  headers: [
    ['host', 'api.example.com'],
    ['content-length', '13'],
    ['content-type', 'application/json'],
    ['x-note', "it's"]
  ],
  body: { encoding: 'text', content: '{"id":"o\'k"}', byteLength: 12 },
  ...over
});

describe('toCurl', () => {
  it('메서드/URL/헤더/본문을 담고, curl이 정하는 헤더는 뺀다', () => {
    const cmd = toCurl(req());
    expect(cmd).toContain("curl -X POST 'https://api.example.com/login?x=1'");
    expect(cmd).toContain("-H 'content-type: application/json'");
    expect(cmd).not.toMatch(/host:|content-length:/i);
    expect(cmd).toContain(`-H 'x-note: it'\\''s'`);
    expect(cmd).toContain(`--data-raw '{"id":"o'\\''k"}'`);
  });

  it('텍스트가 아닌 본문은 넣지 않는다', () => {
    expect(toCurl(req({ body: { encoding: 'base64', content: 'AAA=', byteLength: 2 } }))).not.toContain('--data-raw');
    expect(toCurl(req({ body: { encoding: 'empty', content: '', byteLength: 0 } }))).not.toContain('--data-raw');
  });
});
