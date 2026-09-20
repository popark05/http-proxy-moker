// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProxyService } from '../../src/main/proxy/proxy-service';
import { CaManager } from '../../src/main/cert/ca-manager';

// companion VPN 앱이 요청하는 엔드포인트가 CA를 응답하는지 검증(통합).

let service: ProxyService | undefined;
let caDir: string | undefined;

afterEach(async () => {
  if (service) await service.stop();
  service = undefined;
  if (caDir) await fs.rm(caDir, { recursive: true, force: true });
  caDir = undefined;
});

function getViaProxy(
  proxyPort: number,
  targetUrl: string
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(targetUrl);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: proxyPort,
        method: 'GET',
        path: targetUrl,
        headers: { host: target.host }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('companion 엔드포인트 (통합)', () => {
  it('amiusing.httptoolkit.tech/certificate가 CA PEM을 반환한다', async () => {
    caDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-ca-'));
    const ca = new CaManager(caDir);
    const { cert } = await ca.ensureCa();

    service = new ProxyService(() => {}, ca);
    const status = await service.start(0);

    const result = await getViaProxy(
      status.port!,
      'http://amiusing.httptoolkit.tech/certificate'
    );
    expect(result.status).toBe(200);
    expect(result.body).toBe(cert);
    expect(result.body).toContain('BEGIN CERTIFICATE');
  }, 15_000);

  it('android.httptoolkit.tech/config가 certificate JSON을 반환한다', async () => {
    caDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-ca-'));
    const ca = new CaManager(caDir);
    const { cert } = await ca.ensureCa();

    service = new ProxyService(() => {}, ca);
    const status = await service.start(0);

    const result = await getViaProxy(status.port!, 'http://android.httptoolkit.tech/config');
    expect(result.status).toBe(200);
    const parsed = JSON.parse(result.body);
    expect(parsed.certificate).toBe(cert);
  }, 15_000);

  it('목킹 모드에서도 companion 엔드포인트가 유지된다', async () => {
    caDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-ca-'));
    const ca = new CaManager(caDir);
    service = new ProxyService(() => {}, ca);
    const status = await service.start(0);

    await service.applyMocks(
      [
        {
          id: 'm1',
          label: 'x',
          method: 'GET',
          path: '/x',
          response: { status: 200, headers: [], body: 'mocked' },
          enabled: true
        }
      ],
      'block'
    );

    // 목킹(block) 중에도 companion 인증서 엔드포인트는 응답해야 함.
    const cert = await getViaProxy(status.port!, 'http://amiusing.httptoolkit.tech/certificate');
    expect(cert.status).toBe(200);
    expect(cert.body).toContain('BEGIN CERTIFICATE');
  }, 15_000);
});
