// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { generateCACertificate } from 'mockttp';
import { ProxyEngine } from '../../src/main/proxy/proxy-engine';
import type { CaptureEvent } from '../../src/shared/capture';

let engine: ProxyEngine | undefined;
afterEach(async () => {
  if (engine) await engine.stop();
  engine = undefined;
});

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('HTTPS(CONNECT 터널) 요청의 접속 기기 IP', () => {
  it('CA를 신뢰하는 기기의 복호화된 HTTPS 요청에도 clientIp가 기록된다', async () => {
    const events: CaptureEvent[] = [];
    const ca = await generateCACertificate({ subject: { commonName: 'Test CA' } });
    engine = new ProxyEngine((e) => events.push(e), { cert: ca.cert, key: ca.key });
    const { port } = await engine.start(0);
    await engine.applyMocks(
      [{ id: 'm', label: 'm', method: 'GET', path: '/a', enabled: true, response: { status: 200, headers: [], body: 'ok' } }],
      'passthrough'
    );

    await new Promise<void>((resolve, reject) => {
      const socket = net.connect(port!, '127.0.0.1', () => {
        socket.write('CONNECT secure.example.com:443 HTTP/1.1\r\nHost: secure.example.com:443\r\n\r\n');
      });
      socket.once('data', () => {
        const secure = tls.connect({ socket, servername: 'secure.example.com', ca: [ca.cert] }, () => {
          secure.write('GET /a HTTP/1.1\r\nHost: secure.example.com\r\nUser-Agent: test\r\nConnection: close\r\n\r\n');
        });
        secure.on('data', () => {});
        secure.on('end', () => resolve());
        secure.on('error', reject);
      });
      socket.on('error', reject);
    });

    await waitFor(() => events.some((e) => e.type === 'request'));
    const request = events.find((e) => e.type === 'request');
    expect(request && request.type === 'request' && request.exchange.request.url).toContain('https://secure.example.com/a');
    expect(request && request.type === 'request' && request.exchange.request.clientIp).toBe('127.0.0.1');
  }, 15_000);
});
