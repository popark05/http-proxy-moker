import { describe, it, expect } from 'vitest';
import { encodeBody, isProbablyText } from '../../src/main/proxy/body-encoding';

describe('isProbablyText', () => {
  it('UTF-8 텍스트는 true', () => {
    expect(isProbablyText(Buffer.from('hello 안녕', 'utf-8'))).toBe(true);
  });
  it('NUL 바이트 포함 이진은 false', () => {
    expect(isProbablyText(Buffer.from([0x48, 0x00, 0x49]))).toBe(false);
  });
  it('잘못된 UTF-8 시퀀스는 false', () => {
    expect(isProbablyText(Buffer.from([0xff, 0xfe, 0xfd]))).toBe(false);
  });
});

describe('encodeBody', () => {
  it('빈 버퍼는 empty', () => {
    const result = encodeBody(Buffer.alloc(0));
    expect(result.encoding).toBe('empty');
    expect(result.byteLength).toBe(0);
  });

  it('undefined는 empty', () => {
    expect(encodeBody(undefined).encoding).toBe('empty');
  });

  it('텍스트는 text 인코딩 + 원본 내용', () => {
    const result = encodeBody(Buffer.from('{"a":1}', 'utf-8'), 'application/json');
    expect(result.encoding).toBe('text');
    expect(result.content).toBe('{"a":1}');
    expect(result.contentType).toBe('application/json');
  });

  it('이진은 base64 인코딩', () => {
    const bin = Buffer.from([0x00, 0x01, 0x02, 0xff]);
    const result = encodeBody(bin);
    expect(result.encoding).toBe('base64');
    expect(Buffer.from(result.content, 'base64')).toEqual(bin);
  });

  it('크기 제한 초과는 omitted(길이 보존)', () => {
    const big = Buffer.from('a'.repeat(20));
    const result = encodeBody(big, 'text/plain', 10);
    expect(result.encoding).toBe('omitted');
    expect(result.byteLength).toBe(20);
    expect(result.content).toBe('');
  });
});
