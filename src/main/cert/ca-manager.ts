import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { generateCACertificate, generateSPKIFingerprint } from 'mockttp';
import type { CaInfo } from '@shared/certificate';

export interface CaKeyPair {
  key: string;
  cert: string;
}

/**
 * CA 인증서를 생성/저장/로드한다.
 * 앱 데이터 디렉토리(dataDir)에 ca.pem/ca.key로 저장하고 재사용한다.
 */
export class CaManager {
  private readonly certPath: string;
  private readonly keyPath: string;
  private cached: CaKeyPair | undefined;

  constructor(private readonly dataDir: string) {
    this.certPath = path.join(dataDir, 'ca.pem');
    this.keyPath = path.join(dataDir, 'ca.key');
  }

  /** 저장된 CA를 로드하거나, 없으면 새로 생성해 저장한다. */
  async ensureCa(): Promise<CaKeyPair> {
    if (this.cached) return this.cached;

    const existing = await this.loadFromDisk();
    if (existing) {
      this.cached = existing;
      return existing;
    }

    const generated = await generateCACertificate({
      subject: {
        commonName: 'MokerProxy QA CA - DO NOT TRUST - TESTING ONLY',
        organizationName: 'MokerProxy',
        countryName: 'XX'
      },
      bits: 2048
    });

    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.writeFile(this.certPath, generated.cert, 'utf-8');
    await fs.writeFile(this.keyPath, generated.key, { encoding: 'utf-8', mode: 0o600 });

    this.cached = generated;
    return generated;
  }

  private async loadFromDisk(): Promise<CaKeyPair | undefined> {
    try {
      const [cert, key] = await Promise.all([
        fs.readFile(this.certPath, 'utf-8'),
        fs.readFile(this.keyPath, 'utf-8')
      ]);
      return { cert, key };
    } catch {
      return undefined;
    }
  }

  /** 현재 CA의 메타데이터(지문/유효기간)를 계산해 반환. */
  async getInfo(): Promise<CaInfo> {
    const { cert } = await this.ensureCa();
    return computeCaInfo(cert);
  }
}

/** PEM 인증서에서 표시/검증용 메타데이터를 계산한다. */
export async function computeCaInfo(certPem: string): Promise<CaInfo> {
  const spkiSha256 = await generateSPKIFingerprint(certPem);
  const der = pemToDer(certPem);
  const fingerprintSha256 = colonHex(crypto.createHash('sha256').update(der).digest('hex'));
  const notAfter = new crypto.X509Certificate(certPem).validTo;
  return {
    certPem,
    spkiSha256,
    fingerprintSha256,
    notAfter: new Date(notAfter).getTime()
  };
}

/** PEM(base64 본문)을 DER 버퍼로 변환. */
export function pemToDer(pem: string): Buffer {
  const base64 = pem
    .replace(/-----BEGIN CERTIFICATE-----/, '')
    .replace(/-----END CERTIFICATE-----/, '')
    .replace(/\s+/g, '');
  return Buffer.from(base64, 'base64');
}

/** hex 문자열을 콜론 구분(AA:BB:CC...) 대문자로 포맷. */
export function colonHex(hex: string): string {
  return (hex.match(/.{2}/g) ?? []).join(':').toUpperCase();
}
