// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AdbKeyPair,
  defaultAdbKeyDir,
  parsePrivateKey,
  toAdbPublicKey
} from '../../../src/main/adb/protocol/key-pair';

// dadb PKCS8Test의 테스트 키(Apache-2.0).
const KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDFEQkuoaxVU887
bugJRfNr8cOxRtzONcX9dS8XrFxsRqUWnfrwmo0sraMAfWTdRSiknU5yeirIr6Io
zuVHV0gjRNcQMJtenNZzWVFt9VzkMYVxTH0vJJ1Ik5rVd7BHNXLT7T/ta1MiLimv
26u5xdJEG5pXGvg767G6koyCnpePx0aIUbtQM49QyyTHuA49Dqqxrz3Zo+rxtdhk
s+n6iGXK+2OiSV1Va5DL+1EH+s3/RULxeFNZMmOAK29qLwvUf5t4q2X9/ZIP7j4g
QbTnLzM3P7hQvcLDjIRQZL/J0Nk7XH4gaPQzyvppVav7S3vel0ksbGS/PLvUJiWn
21KXz/KtAgMBAAECggEAKD8c8XWaVQjbS2eQowgyuSp0jXmL8d9gkq2CkyKj84cQ
A0j7bXUa/PNvVVPGrDwKG2h3E4EoyLi59PygLcxBEtbl10weBxof4AnvS/Yu5PnK
J4P4Ew82whJHLm6VxU1AqNCM3EetgE8OO3ixHy0sDrXWdRCwfshZkWGJqcmK6ZVs
7x7t7tEIPA60Nq8iSncPrlIvBk5OLCZx783Lu30H/t3q9jEuLedfKasD20yn6e6R
NZgPoB+b9tT7y1bqKo5CC4BWQcEUj1fn6MAqrgmZY3sErDQYJozCIgKTJjlCi+uB
90rEUKKOYuD+9cq47m1T4OSmWxpsgIJH68G85eTFHwKBgQDhRRONmPMnYYE5iPpH
OvQTCFrVNA6QV/s5dqlxGfQ1ZSliTCtb2xdblxvkgialgus/s3JQlNRefWkBC1eD
klnbT8kEWRsspRWIVKFNRDhvy5JC9dP4QFc9uGsEo/z/u2NKJwlPFadMcn8rzYO3
CIAvGvyVNUiX65YPQNhkp2O4SwKBgQDf8wnAZJ2jPCtXAanWn4mq2QFfo2zkWeRG
4qWFcpOk7bKGr1mC1sk0OINRvVCVCX8p073I2SJfIHu1RrM9StAyBmRIzABaGv5d
lxCyzNr7vzb8PcJa1F0wgcGItvsmTKCGU9j4+HtHaw2qNq4ncz+ig1g98T3VQtqn
ZoLYXxOV5wKBgQCoM1GkOn3j+7PnZ9WodeZkh6p64wG02VylzWo7HuvvKne6A7Gk
RnSsWKnk9yEwGA7bY3uJm3bujqlmtDdF8HLThEFN09KshR8MylQeQz/4iYHOKYt6
I2CAn0CZGHEB6cL7TSZwPHTMafl2lV8xvVEo2veZ2U040hkbjomErk+Q/QKBgCbb
OWbrTjqjVvW6sSgu+CjvjAB3D46zVhtCeeukjJ+CKoaZ6BL+h1yLLaXCDjg9tJWi
SnyNyBvvO+ehA7pvv53eZAoJc0ovAtFkQ55yUtB5ReYQJSezTxP6f4TkEsF7bCLC
a5QPMPycQ3u0DxWDNphQ57+fmtXkyqFe9Pbr0C8jAoGAToZRp2GJXbZzkrzFEaSr
Bg0f0LLef2B+GuYBqJX4UsXhT/m6rK/XFbg5UWb22DJaPKbNg0NaiGn7qovmV0Zk
BghUTEzffGY1lvQverDFHanGe0wC/bHsfKQdonhn8Q50SZUltjohad+/u+BCx0rW
P0NjIV7jJ/npgiCgjAXvCxQ=
-----END PRIVATE KEY-----`;

/** dadb SIGNATURE_PADDING(236바이트): 00 01 FF..FF 00 + SHA-1 DigestInfo 접두사. */
function dadbSignaturePadding(): Buffer {
  const digestInfo = Buffer.from('3021300906052b0e03021a05000414', 'hex');
  const ff = Buffer.alloc(256 - 20 - digestInfo.length - 3, 0xff);
  return Buffer.concat([Buffer.from([0x00, 0x01]), ff, Buffer.from([0x00]), digestInfo]);
}

let tmpDir: string | undefined;
afterEach(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
});

async function makeTmpDir(): Promise<string> {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adbkey-'));
  return tmpDir;
}

function wordsToBigInt(buf: Buffer, offset: number, words: number): bigint {
  let v = 0n;
  for (let i = words - 1; i >= 0; i--) v = (v << 32n) | BigInt(buf.readUInt32LE(offset + i * 4));
  return v;
}

describe('parsePrivateKey', () => {
  // dadb PKCS8Test 이식.
  it('PKCS#8 PEM을 파싱', () => {
    expect(parsePrivateKey(KEY).asymmetricKeyType).toBe('rsa');
  });

  it('RSA가 아닌 키는 거부', () => {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expect(() => parsePrivateKey(pem)).toThrow(/RSA/);
  });
});

describe('AdbKeyPair.signToken', () => {
  const privateKey = parsePrivateKey(KEY);
  const token = crypto.randomBytes(20);

  it('dadb의 NoPadding 서명과 바이트 단위로 동일', () => {
    const keyPair = new AdbKeyPair(privateKey, Buffer.alloc(0));
    const expected = crypto.privateEncrypt(
      { key: privateKey, padding: crypto.constants.RSA_NO_PADDING },
      Buffer.concat([dadbSignaturePadding(), token])
    );
    expect(keyPair.signToken(token)).toEqual(expected);
  });

  it('공개키로 복호화하면 DigestInfo + 토큰(adbd 검증 방식)', () => {
    const signature = new AdbKeyPair(privateKey, Buffer.alloc(0)).signToken(token);
    const recovered = crypto.publicDecrypt(
      { key: crypto.createPublicKey(privateKey), padding: crypto.constants.RSA_PKCS1_PADDING },
      signature
    );
    expect(recovered).toEqual(Buffer.concat([dadbSignaturePadding().subarray(-15), token]));
  });
});

describe('toAdbPublicKey', () => {
  const publicKey = crypto.createPublicKey(parsePrivateKey(KEY));
  const struct = toAdbPublicKey(publicKey);
  const jwk = publicKey.export({ format: 'jwk' });
  const n = BigInt(`0x${Buffer.from(jwk.n!, 'base64url').toString('hex')}`);

  it('524바이트, len=64, exponent=65537', () => {
    expect(struct.length).toBe(524);
    expect(struct.readUInt32LE(0)).toBe(64);
    expect(struct.readUInt32LE(520)).toBe(65537);
  });

  it('n은 modulus의 리틀엔디언 워드 배열', () => {
    expect(wordsToBigInt(struct, 8, 64)).toBe(n);
  });

  it('n0inv * n[0] ≡ -1 (mod 2^32)', () => {
    const n0inv = BigInt(struct.readUInt32LE(4));
    const n0 = BigInt(struct.readUInt32LE(8));
    expect((n0inv * n0) % (1n << 32n)).toBe((1n << 32n) - 1n);
  });

  it('rr = (2^2048)^2 mod n', () => {
    expect(wordsToBigInt(struct, 8 + 256, 64)).toBe(((1n << 2048n) ** 2n) % n);
  });

  it('2048비트가 아닌 키는 거부', () => {
    const { publicKey: small } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
    expect(() => toAdbPublicKey(small)).toThrow(/2048/);
  });
});

describe('defaultAdbKeyDir', () => {
  it('adb와 같은 <홈>/.android, ANDROID_USER_HOME은 보지 않음(adb도 보지 않음)', () => {
    const before = process.env.ANDROID_USER_HOME;
    try {
      process.env.ANDROID_USER_HOME = path.join(os.tmpdir(), 'elsewhere');
      expect(defaultAdbKeyDir()).toBe(path.join(os.homedir(), '.android'));
      expect(defaultAdbKeyDir('/home/qa')).toBe(path.join('/home/qa', '.android'));
    } finally {
      if (before === undefined) delete process.env.ANDROID_USER_HOME;
      else process.env.ANDROID_USER_HOME = before;
    }
  });
});

describe('AdbKeyPair 파일 입출력', () => {
  it('readDefault: 키가 없으면 생성하고 adb 형식으로 저장', async () => {
    const dir = await makeTmpDir();
    const keyPair = await AdbKeyPair.readDefault(dir);

    const privatePem = await fs.readFile(path.join(dir, 'adbkey'), 'utf-8');
    expect(privatePem).toContain('-----BEGIN PRIVATE KEY-----');
    // Windows에는 Unix 권한이 없다(사용자 프로필 폴더 ACL로 보호).
    if (process.platform !== 'win32') {
      const stat = await fs.stat(path.join(dir, 'adbkey'));
      expect(stat.mode & 0o777).toBe(0o600);
    }

    const pubLine = await fs.readFile(path.join(dir, 'adbkey.pub'), 'utf-8');
    const [b64, comment] = pubLine.split(' ');
    expect(Buffer.from(b64, 'base64').length).toBe(524);
    expect(comment).toMatch(/.+@.+/);

    // 전송용 바이트 = 파일 내용 + NUL.
    expect(keyPair.publicKeyBytes).toEqual(Buffer.concat([Buffer.from(pubLine), Buffer.from([0])]));
  });

  it('readDefault: 기존 키가 있으면 재사용', async () => {
    const dir = await makeTmpDir();
    await AdbKeyPair.readDefault(dir);
    const before = await fs.readFile(path.join(dir, 'adbkey'), 'utf-8');
    await AdbKeyPair.readDefault(dir);
    expect(await fs.readFile(path.join(dir, 'adbkey'), 'utf-8')).toBe(before);
  });

  it('read: 공개키 파일이 없으면 개인키에서 유도', async () => {
    const dir = await makeTmpDir();
    const privatePath = path.join(dir, 'adbkey');
    await fs.writeFile(privatePath, KEY);

    const keyPair = await AdbKeyPair.read(privatePath, path.join(dir, 'missing.pub'));
    const text = keyPair.publicKeyBytes.toString('utf-8');
    expect(text.endsWith('\0')).toBe(true);
    const b64 = text.slice(0, text.indexOf(' '));
    expect(Buffer.from(b64, 'base64')).toEqual(
      toAdbPublicKey(crypto.createPublicKey(parsePrivateKey(KEY)))
    );
  });
});
