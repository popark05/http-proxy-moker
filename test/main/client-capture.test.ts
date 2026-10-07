// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
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

describe('접속 기기 수집', () => {
  it('요청에 접속한 기기의 IP를 기록한다', async () => {
    const events: CaptureEvent[] = [];
    engine = new ProxyEngine((e) => events.push(e));
    const { port } = await engine.start(0);
    await engine.applyMocks(
      [{ id: 'm', label: 'm', method: 'GET', path: '/a', enabled: true, response: { status: 200, headers: [], body: 'ok' } }],
      'passthrough'
    );
    await new Promise<void>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: 'http://x.example.com/a', headers: { host: 'x.example.com', 'user-agent': 'okhttp/4.12.0' } }, (res) => {
        res.resume();
        res.on('end', () => resolve());
      });
      req.on('error', reject);
      req.end();
    });
    await waitFor(() => events.some((e) => e.type === 'request'));
    const request = events.find((e) => e.type === 'request');
    expect(request && request.type === 'request' && request.exchange.request.clientIp).toBe('127.0.0.1');
  }, 15_000);

  it('CA를 신뢰하지 않는 기기의 TLS 핸드셰이크 실패를 tls-error로 알린다', async () => {
    const events: CaptureEvent[] = [];
    const ca = await generateCACertificate({ subject: { commonName: 'Test CA' } });
    engine = new ProxyEngine((e) => events.push(e), { cert: ca.cert, key: ca.key });
    const { port } = await engine.start(0);

    // 프록시에 CONNECT로 터널을 열고, CA를 신뢰하지 않는 TLS 클라이언트로 핸드셰이크 → 인증서 거부.
    await new Promise<void>((resolve) => {
      const socket = net.connect(port!, '127.0.0.1', () => {
        socket.write('CONNECT secure.example.com:443 HTTP/1.1\r\nHost: secure.example.com:443\r\n\r\n');
      });
      socket.once('data', () => {
        const secure = tls.connect({ socket, servername: 'secure.example.com', rejectUnauthorized: true });
        secure.on('error', () => {
          socket.destroy();
          resolve();
        });
      });
      socket.on('error', () => resolve());
    });
    await waitFor(() => events.some((e) => e.type === 'tls-error'));
    const err = events.find((e) => e.type === 'tls-error');
    // Node 클라이언트는 거부 알림 없이 소켓을 끊어 reset으로 보고된다(iOS는 cert-rejected일 수 있음).
    expect(err).toMatchObject({ type: 'tls-error', clientIp: '127.0.0.1', hostname: 'secure.example.com' });
    expect(['reset', 'closed', 'cert-rejected']).toContain((err as { cause?: string }).cause);
  }, 15_000);
});
