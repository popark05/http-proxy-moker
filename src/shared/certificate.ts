/**
 * CA 인증서 관련 공유 타입.
 */

export interface CaInfo {
  /** CA 인증서 PEM. */
  certPem: string;
  /** SPKI SHA-256 지문(base64). Android/Chrome 신뢰 검증 등에 사용. */
  spkiSha256: string;
  /** 인증서 SHA-256 지문(hex, 콜론 구분). 사용자에게 표시용. */
  fingerprintSha256: string;
  /** 유효기간(epoch ms). */
  notAfter: number;
}

/** CA 내보내기 형식. */
export type CaExportFormat = 'pem' | 'mobileconfig';
