/**
 * ADB 프로토콜 상수. dadb Constants.kt 이식(Apache-2.0, NOTICE 참고).
 * 명령 값은 4글자 ASCII를 리틀엔디언 uint32로 읽은 값이다(예: 'CNXN').
 */

export const AUTH_TYPE_TOKEN = 1;
export const AUTH_TYPE_SIGNATURE = 2;
export const AUTH_TYPE_RSA_PUBLIC = 3;

export const CMD_AUTH = 0x48545541;
export const CMD_CNXN = 0x4e584e43;
export const CMD_OPEN = 0x4e45504f;
export const CMD_OKAY = 0x59414b4f;
export const CMD_CLSE = 0x45534c43;
export const CMD_WRTE = 0x45545257;
/** adbd가 TLS 업그레이드를 요구할 때(무선 디버깅). 현재 미지원. */
export const CMD_STLS = 0x534c5453;

export const CONNECT_VERSION = 0x01000000;
export const CONNECT_MAXDATA = 1024 * 1024;
export const CONNECT_PAYLOAD = Buffer.from('host::\u0000', 'utf-8');

/** 메시지 헤더 크기(6 x uint32). */
export const HEADER_LENGTH = 24;
