// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import * as https from 'node:https';
import * as http from 'node:http';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProxyEngine } from '../../src/main/proxy/proxy-engine';
import { CaManager } from '../../src/main/cert/ca-manager';
import type { CaptureEvent } from '../../src/shared/capture';

// CA를 주입한 프록시가 HTTPS 트래픽을 복호화해 캡처하는지 검증(통합).

let backend: https.Server | undefined;
let service: ProxyEngine | undefined;
let caDir: string | undefined;

afterEach(async () => {
  if (service) await service.stop();
  service = undefined;
  if (backend) await new Promise<void>((r) => backend!.close(() => r()));
  backend = undefined;
  if (caDir) await fs.rm(caDir, { recursive: true, force: true });
  caDir = undefined;
});

/** 자체 서명 인증서로 HTTPS 백엔드를 띄운다(별도 CA). */
async function startHttpsBackend(): Promise<number> {
  const { generateCACertificate } = await import('mockttp');
  const serverCert = await generateCACertificate({ subject: { commonName: 'localhost' } });

  return new Promise((resolve) => {
    backend = https.createServer(
      { key: serverCert.key, cert: serverCert.cert },
      (req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ secret: 'https-payload', url: req.url }));
      }
    );
    backend.listen(0, () => {
      const address = backend!.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

/** 프록시로 CONNECT 터널을 열어 HTTPS 요청을 보낸다. */
function requestHttpsViaProxy(proxyPort: number, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const connectReq = http.request({
      host: '127.0.0.1',
      port: proxyPort,
      method: 'CONNECT',
      path: `${host}:${port}`
    });

    connectReq.on('connect', (_res, socket) => {
      const tlsReq = https.request(
        {
          socket,
          agent: false,
          host,
          port,
          method: 'GET',
          path: '/secure',
          // 프록시(mockttp)가 제시하는 인증서를 신뢰하지 않으므로 검증 비활성(테스트 목적).
          rejectUnauthorized: false
        },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve());
        }
      );
      tlsReq.on('error', reject);
      tlsReq.end();
    });
    connectReq.on('error', reject);
    connectReq.end();
  });
}

describe('HTTPS 캡처 (통합)', () => {
  it('CA를 주입한 프록시가 HTTPS 본문을 복호화해 캡처한다', async () => {
    caDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-ca-'));
    const ca = new CaManager(caDir);
    const { cert, key } = await ca.ensureCa();
    const backendPort = await startHttpsBackend();

    const events: CaptureEvent[] = [];
    service = new ProxyEngine((e) => events.push(e), { cert, key });
    const status = await service.start(0);

    await requestHttpsViaProxy(status.port!, 'localhost', backendPort);
    await new Promise((r) => setTimeout(r, 300));

    const responseEvent = events.find((e) => e.type === 'response');
    expect(responseEvent).toBeDefined();
    if (responseEvent?.type === 'response') {
      expect(responseEvent.response.statusCode).toBe(200);
      // 복호화가 됐다면 평문 body를 볼 수 있어야 한다.
      expect(responseEvent.response.body.content).toContain('https-payload');
    }
  }, 30_000);
});
