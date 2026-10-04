import { describe, it, expect } from 'vitest';
import type { CapturedBody } from '../../src/shared/capture';
import { displayableImageMime, isSvgText, mimeOf, sniffImageMime, toDataUrl } from '../../src/shared/image-body';

const b64 = (bytes: number[]): string => Buffer.from(bytes).toString('base64');
const PNG = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const body = (content: string, contentType?: string): CapturedBody => ({
  encoding: 'base64',
  content,
  byteLength: 10,
  contentType
});

describe('image-body', () => {
  it('mimeOf는 파라미터를 떼고 소문자로', () => {
    expect(mimeOf('Image/PNG; charset=binary')).toBe('image/png');
    expect(mimeOf(undefined)).toBe('');
  });

  it('선언된 이미지 content-type을 그대로 쓴다', () => {
    expect(displayableImageMime(body(PNG, 'image/png'))).toBe('image/png');
  });

  it('content-type이 없거나 octet-stream이면 매직 넘버로 추정', () => {
    expect(displayableImageMime(body(PNG))).toBe('image/png');
    expect(displayableImageMime(body(PNG, 'application/octet-stream'))).toBe('image/png');
    expect(sniffImageMime(b64([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(sniffImageMime(Buffer.from('GIF89a....').toString('base64'))).toBe('image/gif');
    expect(sniffImageMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 ').toString('base64'))).toBe('image/webp');
  });

  it('이미지가 아니라고 선언된 본문(pdf 등)은 이미지로 취급하지 않는다', () => {
    expect(displayableImageMime(body(PNG, 'application/pdf'))).toBeUndefined();
  });

  it('텍스트/빈 본문은 이미지 아님, SVG 텍스트는 별도 판정', () => {
    expect(displayableImageMime({ encoding: 'text', content: '{}', byteLength: 2 })).toBeUndefined();
    expect(isSvgText({ encoding: 'text', content: '<svg/>', byteLength: 6, contentType: 'image/svg+xml' })).toBe(true);
  });

  it('data URL 생성', () => {
    expect(toDataUrl('image/png', 'AAAA', 'base64')).toBe('data:image/png;base64,AAAA');
    expect(toDataUrl('image/svg+xml', '<svg a="1"/>', 'text')).toBe(
      'data:image/svg+xml;charset=utf-8,%3Csvg%20a%3D%221%22%2F%3E'
    );
  });
});
