/**
 * ADB 인증용 RSA 키 쌍. dadb AdbKeyPair/PKCS8 이식(Apache-2.0, NOTICE 참고).
 *
 * adb 바이너리와 같은 ~/.android/adbkey(PKCS#8 PEM)를 쓰므로, adb로 이미 허용한 기기는
 * 다시 "USB 디버깅 허용" 팝업 없이 연결된다.
 */

import * as crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const KEY_LENGTH_BITS = 2048;
const KEY_LENGTH_WORDS = KEY_LENGTH_BITS / 32;
/** ADB RSAPublicKey 구조체 크기: len + n0inv + n[64] + rr[64] + exponent. */
const ADB_PUBLIC_KEY_SIZE = 4 + 4 + KEY_LENGTH_WORDS * 4 * 2 + 4;

/**
 * SHA-1 DigestInfo 접두사. adbd는 토큰(20바이트)을 "이미 해시된 SHA-1 값"으로 보고 검증하므로,
 * PKCS#1 v1.5 type 1 패딩 + 이 접두사 + 토큰을 개인키로 원시 서명한다.
 * dadb는 00 01 FF.. 00 까지 포함한 전체 패딩을 NoPadding으로 암호화하는데, 결과는 동일하다.
 */
const SHA1_DIGEST_INFO_PREFIX = Buffer.from([
  0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a, 0x05, 0x00, 0x04, 0x14
]);

/** adb 키 기본 디렉토리. adb와 동일하게 ANDROID_USER_HOME을 우선한다. */
export function defaultAdbKeyDir(): string {
  return process.env.ANDROID_USER_HOME ?? path.join(os.homedir(), '.android');
}

export class AdbKeyPair {
  constructor(
    private readonly privateKey: crypto.KeyObject,
    /** AUTH(RSAPUBLICKEY)로 보낼 바이트: "<base64 공개키> <user@host>\0". */
    readonly publicKeyBytes: Buffer
  ) {}

  /** adbd가 보낸 AUTH 토큰에 서명한다. */
  signToken(token: Uint8Array): Buffer {
    return crypto.privateEncrypt(
      { key: this.privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.concat([SHA1_DIGEST_INFO_PREFIX, token])
    );
  }

  /** 기본 경로(~/.android/adbkey)의 키를 읽는다. 없으면 생성한다. */
  static async readDefault(dir: string = defaultAdbKeyDir()): Promise<AdbKeyPair> {
    const privatePath = path.join(dir, 'adbkey');
    const publicPath = path.join(dir, 'adbkey.pub');
    if (!(await exists(privatePath))) {
      await AdbKeyPair.generate(privatePath, publicPath);
    }
    return AdbKeyPair.read(privatePath, publicPath);
  }

  /**
   * 개인키(PEM)와 선택적 공개키 파일을 읽는다.
   * 공개키 파일이 없으면 개인키에서 ADB 형식 공개키를 유도한다(dadb는 빈 값을 보내 기기 팝업이 안 뜸).
   */
  static async read(privatePath: string, publicPath?: string): Promise<AdbKeyPair> {
    const privateKey = parsePrivateKey(await fs.readFile(privatePath, 'utf-8'));
    const publicKeyBytes =
      publicPath && (await exists(publicPath))
        ? withNul(await fs.readFile(publicPath))
        : withNul(Buffer.from(formatPublicKeyLine(privateKey), 'utf-8'));
    return new AdbKeyPair(privateKey, publicKeyBytes);
  }

  /** 2048비트 RSA 키를 새로 만들어 adb와 같은 형식으로 저장한다. */
  static async generate(privatePath: string, publicPath: string): Promise<void> {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: KEY_LENGTH_BITS,
      publicExponent: 65537
    });
    await fs.mkdir(path.dirname(privatePath), { recursive: true });
    await fs.mkdir(path.dirname(publicPath), { recursive: true });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    await fs.writeFile(privatePath, pem, { mode: 0o600 });
    await fs.writeFile(publicPath, formatPublicKeyLine(privateKey));
  }
}

/** PKCS#8("BEGIN PRIVATE KEY") 또는 PKCS#1("BEGIN RSA PRIVATE KEY") PEM을 파싱한다. */
export function parsePrivateKey(pem: string): crypto.KeyObject {
  const key = crypto.createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'rsa') {
    throw new Error(`ADB 키는 RSA여야 합니다(현재: ${key.asymmetricKeyType}).`);
  }
  return key;
}

/** adbkey.pub 한 줄: "<base64(RSAPublicKey 구조체)> <user@host>". */
function formatPublicKeyLine(privateKey: crypto.KeyObject): string {
  const struct = toAdbPublicKey(crypto.createPublicKey(privateKey));
  return `${struct.toString('base64')} ${adbKeyComment()}`;
}

function adbKeyComment(): string {
  try {
    return `${os.userInfo().username}@${os.hostname()}`;
  } catch {
    return 'unknown@unknown';
  }
}

/**
 * RSA 공개키를 adbd가 이해하는 RSAPublicKey 구조체(524바이트, 리틀엔디언)로 변환한다.
 *
 *   typedef struct RSAPublicKey {
 *     uint32_t len;                 // n[]의 워드 수(64)
 *     uint32_t n0inv;               // -1 / n[0] mod 2^32
 *     uint32_t n[RSANUMWORDS];      // modulus, 리틀엔디언 워드 배열
 *     uint32_t rr[RSANUMWORDS];     // R^2 mod n (R = 2^2048)
 *     int32_t  exponent;            // 65537
 *   } RSAPublicKey;
 */
export function toAdbPublicKey(publicKey: crypto.KeyObject): Buffer {
  const jwk = publicKey.export({ format: 'jwk' });
  if (!jwk.n || !jwk.e) throw new Error('RSA 공개키 JWK 변환 실패');
  const n = bytesToBigInt(Buffer.from(jwk.n, 'base64url'));
  const e = bytesToBigInt(Buffer.from(jwk.e, 'base64url'));

  const bits = n.toString(2).length;
  if (bits !== KEY_LENGTH_BITS) {
    throw new Error(`ADB 키는 ${KEY_LENGTH_BITS}비트 RSA여야 합니다(현재: ${bits}비트).`);
  }

  const r32 = 1n << 32n;
  const r = 1n << BigInt(KEY_LENGTH_BITS);
  const rr = (r * r) % n;
  const n0inv = (r32 - modInverse(n % r32, r32)) % r32;

  const out = Buffer.alloc(ADB_PUBLIC_KEY_SIZE);
  let offset = 0;
  out.writeUInt32LE(KEY_LENGTH_WORDS, offset);
  offset += 4;
  out.writeUInt32LE(Number(n0inv), offset);
  offset += 4;
  offset = writeWordsLE(out, offset, n);
  offset = writeWordsLE(out, offset, rr);
  out.writeUInt32LE(Number(e), offset);
  return out;
}

function writeWordsLE(out: Buffer, offset: number, value: bigint): number {
  let rest = value;
  for (let i = 0; i < KEY_LENGTH_WORDS; i++) {
    out.writeUInt32LE(Number(rest & 0xffffffffn), offset);
    rest >>= 32n;
    offset += 4;
  }
  return offset;
}

function bytesToBigInt(bytes: Buffer): bigint {
  return bytes.length === 0 ? 0n : BigInt(`0x${bytes.toString('hex')}`);
}

/** 확장 유클리드 호제법으로 a^-1 mod m. */
function modInverse(a: bigint, m: bigint): bigint {
  let [oldR, r] = [a % m, m];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  if (oldR !== 1n) throw new Error('모듈러 역원이 존재하지 않습니다.');
  return ((oldS % m) + m) % m;
}

function withNul(bytes: Buffer): Buffer {
  return Buffer.concat([bytes, Buffer.from([0])]);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
