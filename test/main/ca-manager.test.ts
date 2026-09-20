// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CaManager, computeCaInfo, pemToDer, colonHex } from '../../src/main/cert/ca-manager';

describe('colonHex', () => {
  it('hex를 콜론 구분 대문자로 포맷한다', () => {
    expect(colonHex('aabbcc')).toBe('AA:BB:CC');
  });
});

describe('pemToDer', () => {
  it('PEM 헤더/공백을 제거하고 DER 버퍼로 변환한다', () => {
    const b64 = Buffer.from('hello').toString('base64');
    const pem = `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----`;
    expect(pemToDer(pem).toString()).toBe('hello');
  });
});

describe('CaManager', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('CA를 생성해 디스크에 저장하고 재사용한다', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-ca-'));
    const manager = new CaManager(dir);

    const first = await manager.ensureCa();
    expect(first.cert).toContain('BEGIN CERTIFICATE');
    expect(first.key).toContain('PRIVATE KEY');

    // 파일이 저장됐는지 확인
    await fs.access(path.join(dir, 'ca.pem'));
    await fs.access(path.join(dir, 'ca.key'));

    // 새 매니저가 동일 CA를 로드
    const reloaded = await new CaManager(dir).ensureCa();
    expect(reloaded.cert).toBe(first.cert);
  }, 20_000);

  it('getInfo는 지문과 유효기간을 계산한다', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-ca-'));
    const manager = new CaManager(dir);
    const info = await manager.getInfo();

    expect(info.fingerprintSha256).toMatch(/^[0-9A-F:]+$/);
    expect(info.spkiSha256.length).toBeGreaterThan(0);
    expect(info.notAfter).toBeGreaterThan(Date.now());
  }, 20_000);
});

describe('computeCaInfo', () => {
  it('생성된 CA의 지문을 계산한다', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-ca-'));
    try {
      const { cert } = await new CaManager(dir).ensureCa();
      const info = await computeCaInfo(cert);
      expect(info.certPem).toBe(cert);
      expect(info.fingerprintSha256.split(':').length).toBe(32); // SHA-256 = 32바이트
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
