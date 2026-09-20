import { CAPTURE_BODY_SIZE_LIMIT, type CapturedBody } from '@shared/capture';

/**
 * 디코딩된 body 버퍼를 IPC 전송용 CapturedBody로 변환한다.
 * - 빈 본문: empty
 * - 크기 제한 초과: omitted (byteLength는 보존)
 * - utf-8로 디코딩 가능(치환문자 없음): text
 * - 그 외 이진 데이터: base64
 */
export function encodeBody(
  buffer: Buffer | undefined,
  contentType?: string,
  sizeLimit: number = CAPTURE_BODY_SIZE_LIMIT
): CapturedBody {
  if (!buffer || buffer.byteLength === 0) {
    return { encoding: 'empty', content: '', byteLength: 0, contentType };
  }

  const byteLength = buffer.byteLength;

  if (byteLength > sizeLimit) {
    return { encoding: 'omitted', content: '', byteLength, contentType };
  }

  if (isProbablyText(buffer)) {
    return { encoding: 'text', content: buffer.toString('utf-8'), byteLength, contentType };
  }

  return { encoding: 'base64', content: buffer.toString('base64'), byteLength, contentType };
}

/**
 * 버퍼가 유효한 UTF-8 텍스트인지 판정.
 * UTF-8 재인코딩이 원본과 일치하면 텍스트로 간주(치환문자/손실 없음).
 */
export function isProbablyText(buffer: Buffer): boolean {
  // NUL 바이트가 있으면 이진으로 간주.
  if (buffer.includes(0)) return false;
  const decoded = buffer.toString('utf-8');
  return Buffer.from(decoded, 'utf-8').equals(buffer);
}
