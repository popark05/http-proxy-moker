// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import * as crypto from 'node:crypto';
import { AdbConnection, parseBanner } from '../../../src/main/adb/protocol/connection';
import { AdbKeyPair } from '../../../src/main/adb/protocol/key-pair';
import {
  AUTH_TYPE_RSA_PUBLIC,
  AUTH_TYPE_SIGNATURE,
  AUTH_TYPE_TOKEN,
  CMD_AUTH,
  CMD_CNXN,
  CMD_OKAY,
  CMD_STLS,
  CONNECT_MAXDATA,
  CONNECT_VERSION
} from '../../../src/main/adb/protocol/constants';
import {
  AdbAuthException,
  AdbConnectException,
  AdbProtocolException
} from '../../../src/main/adb/errors';
import { DEVICE_BANNER, FakeAdbd, msg } from './fake-adbd';
import type { AdbMessage } from '../../../src/main/adb/protocol/message';

let keyPair: AdbKeyPair;
let publicKey: crypto.KeyObject;

beforeAll(() => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  publicKey = pair.publicKey;
  keyPair = new AdbKeyPair(pair.privateKey, Buffer.from('PUBKEY test@host\0'));
});

const cnxn = (): AdbMessage => msg(CMD_CNXN, 0x01000001, 256 * 1024, DEVICE_BANNER);
const token = (): AdbMessage => msg(CMD_AUTH, AUTH_TYPE_TOKEN, 0, crypto.randomBytes(20));

/** 실제 adbd처럼 토큰 서명을 공개키로 검증한다. */
function verifies(signature: Buffer, sentToken: Buffer): boolean {
  try {
    const recovered = crypto.publicDecrypt(
      { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
      signature
    );
    return recovered.subarray(-20).equals(sentToken);
  } catch {
    return false;
  }
}

describe('AdbConnection.connect', () => {
  it('인증 없는 기기(에뮬레이터 등): CNXN → CNXN', async () => {
    const adbd = new FakeAdbd((m) => (m.command === CMD_CNXN ? [cnxn()] : []));
    const conn = await AdbConnection.connect(adbd.transport);

    const hello = adbd.received[0];
    expect(hello.command).toBe(CMD_CNXN);
    expect(hello.arg0).toBe(CONNECT_VERSION);
    expect(hello.arg1).toBe(CONNECT_MAXDATA);
    expect(hello.payload.toString()).toBe('host::\0');

    expect(conn.version).toBe(0x01000001);
    expect(conn.maxPayloadSize).toBe(256 * 1024);
    expect(conn.banner.state).toBe('device');
    expect(conn.banner.properties['ro.product.model']).toBe('sdk_gphone64_arm64');
    expect(conn.supportsFeature('shell_v2')).toBe(true);
    expect(conn.supportsFeature('nope')).toBe(false);
  });

  it('이미 허용된 키: 서명이 검증되면 CNXN', async () => {
    let sent: AdbMessage | undefined;
    const adbd = new FakeAdbd((m) => {
      if (m.command === CMD_CNXN) return [(sent = token())];
      if (m.command === CMD_AUTH && m.arg0 === AUTH_TYPE_SIGNATURE) {
        return verifies(m.payload, sent!.payload) ? [cnxn()] : [token()];
      }
    });
    const conn = await AdbConnection.connect(adbd.transport, { keyPair });
    expect(conn.banner.state).toBe('device');
    expect(adbd.received.map((m) => m.arg0)).not.toContain(AUTH_TYPE_RSA_PUBLIC);
  });

  it('처음 보는 키: 서명 거부 → 공개키 전송 → 사용자 허용 후 CNXN', async () => {
    const adbd = new FakeAdbd((m) => {
      if (m.command === CMD_CNXN) return [token()];
      if (m.command === CMD_AUTH && m.arg0 === AUTH_TYPE_SIGNATURE) return [token()];
      if (m.command === CMD_AUTH && m.arg0 === AUTH_TYPE_RSA_PUBLIC) return [cnxn()];
    });
    await AdbConnection.connect(adbd.transport, { keyPair });

    const pub = adbd.received.find((m) => m.command === CMD_AUTH && m.arg0 === AUTH_TYPE_RSA_PUBLIC);
    expect(pub?.payload).toEqual(keyPair.publicKeyBytes);
  });

  it('공개키 전송 후에도 AUTH면 AdbAuthException(unauthorized)', async () => {
    const adbd = new FakeAdbd((m) => (m.command === CMD_CNXN || m.command === CMD_AUTH ? [token()] : []));
    await expect(AdbConnection.connect(adbd.transport, { keyPair })).rejects.toBeInstanceOf(
      AdbAuthException
    );
    expect(adbd.transport.closed).toBe(true);
  });

  it('사용자가 허용하지 않으면 authTimeout 후 AdbAuthException', async () => {
    const adbd = new FakeAdbd((m) => {
      if (m.command === CMD_CNXN) return [token()];
      if (m.command === CMD_AUTH && m.arg0 === AUTH_TYPE_SIGNATURE) return [token()];
      // 공개키에는 응답하지 않음(팝업 대기 중).
    });
    const thrown = await AdbConnection.connect(adbd.transport, { keyPair, authTimeoutMs: 20 }).catch(
      (e) => e
    );
    expect(thrown).toBeInstanceOf(AdbAuthException);
    expect(thrown.message).toContain('허용');
  });

  it('인증이 필요한데 키가 없으면 AdbAuthException', async () => {
    const adbd = new FakeAdbd((m) => (m.command === CMD_CNXN ? [token()] : []));
    await expect(AdbConnection.connect(adbd.transport)).rejects.toBeInstanceOf(AdbAuthException);
  });

  it('TOKEN이 아닌 AUTH 타입은 AdbProtocolException', async () => {
    const adbd = new FakeAdbd((m) =>
      m.command === CMD_CNXN ? [msg(CMD_AUTH, AUTH_TYPE_SIGNATURE, 0, 'x')] : []
    );
    await expect(AdbConnection.connect(adbd.transport, { keyPair })).rejects.toBeInstanceOf(
      AdbProtocolException
    );
  });

  it('STLS(무선 디버깅 TLS)는 미지원 AdbConnectException', async () => {
    const adbd = new FakeAdbd((m) => (m.command === CMD_CNXN ? [msg(CMD_STLS, 0x01000000, 0)] : []));
    const thrown = await AdbConnection.connect(adbd.transport).catch((e) => e);
    expect(thrown).toBeInstanceOf(AdbConnectException);
    expect(thrown.message).toContain('TLS');
  });

  it('예상 밖 응답은 AdbConnectException', async () => {
    const adbd = new FakeAdbd((m) => (m.command === CMD_CNXN ? [msg(CMD_OKAY, 0, 0)] : []));
    await expect(AdbConnection.connect(adbd.transport)).rejects.toBeInstanceOf(AdbConnectException);
  });

  it('핸드셰이크 중 연결이 끊기면 AdbConnectException(원인 보존)', async () => {
    const adbd = new FakeAdbd((_m, self) => {
      queueMicrotask(() => self.transport.remoteClose(new Error('reset')));
    });
    const thrown = await AdbConnection.connect(adbd.transport).catch((e) => e);
    expect(thrown).toBeInstanceOf(AdbConnectException);
    expect(thrown.cause).toBeDefined();
  });

  it('응답이 없으면 handshakeTimeout 후 AdbConnectException', async () => {
    const adbd = new FakeAdbd(() => []);
    await expect(
      AdbConnection.connect(adbd.transport, { handshakeTimeoutMs: 20 })
    ).rejects.toBeInstanceOf(AdbConnectException);
    expect(adbd.transport.closed).toBe(true);
  });

  it('close는 전송을 닫고 멱등', async () => {
    const adbd = new FakeAdbd((m) => (m.command === CMD_CNXN ? [cnxn()] : []));
    const conn = await AdbConnection.connect(adbd.transport);
    await conn.close();
    await conn.close();
    expect(adbd.transport.closed).toBe(true);
  });
});

describe('parseBanner', () => {
  it('상태/속성/features 분리', () => {
    const banner = parseBanner(DEVICE_BANNER);
    expect(banner.state).toBe('device');
    expect(banner.properties).toEqual({
      'ro.product.name': 'sdk_gphone64_arm64',
      'ro.product.model': 'sdk_gphone64_arm64',
      'ro.product.device': 'emu64a'
    });
    expect([...banner.features]).toEqual(['shell_v2', 'cmd', 'stat_v2', 'abb_exec', 'fixed_push_mkdir']);
  });

  it('recovery 등 다른 상태도 인식', () => {
    expect(parseBanner('recovery::features=cmd').state).toBe('recovery');
  });

  it('features가 없으면 AdbConnectException', () => {
    expect(() => parseBanner('device::ro.product.name=x')).toThrow(AdbConnectException);
  });
});
