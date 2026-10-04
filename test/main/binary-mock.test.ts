// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import { ProxyEngine } from '../../src/main/proxy/proxy-engine';
import { exchangeToMock } from '../../src/shared/mock-convert';
import type { CapturedExchange } from '../../src/shared/capture';

// 이진(이미지) 응답을 목으로 복제했을 때, 프록시가 원본 바이트 그대로 서비스하는지 검증(통합).

let engine: ProxyEngine | undefined;
afterEach(async () => {
  if (engine) await engine.stop();
  engine = undefined;
});

function getViaProxy(
  proxyPort: number,
  targetUrl: string
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const target = new URL(targetUrl);
    const req = http.request(
      { host: '127.0.0.1', port: proxyPort, method: 'GET', path: targetUrl, headers: { host: target.host } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// UTF-8로 해석하면 깨지는 바이트(0x89, 0xFF, 0x00 포함)로 텍스트 경로와의 차이를 드러낸다.
const BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80]);

const exchange: CapturedExchange = {
  id: 'img',
  startedAt: 1,
  request: {
    method: 'GET',
    url: 'http://img.example.com/logo.png',
    path: '/logo.png',
    headers: [],
    body: { encoding: 'empty', content: '', byteLength: 0 }
  },
  response: {
    statusCode: 200,
    statusMessage: 'OK',
    headers: [['content-type', 'image/png']],
    body: { encoding: 'base64', content: BYTES.toString('base64'), byteLength: BYTES.length, contentType: 'image/png' }
  }
};

describe('이진 응답 목', () => {
  it('복제한 이미지 목이 원본 바이트 그대로 응답한다', async () => {
    engine = new ProxyEngine(() => {});
    const { port } = await engine.start(0);
    await engine.applyMocks([exchangeToMock(exchange, 'm1')], 'passthrough');

    const res = await getViaProxy(port!, 'http://img.example.com/logo.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body.equals(BYTES)).toBe(true);
  }, 15_000);

  it('텍스트 목은 기존대로 동작(회귀)', async () => {
    engine = new ProxyEngine(() => {});
    const { port } = await engine.start(0);
    const text = exchangeToMock(
      { ...exchange, response: { statusCode: 200, statusMessage: 'OK', headers: [], body: { encoding: 'text', content: 'héllo', byteLength: 6 } } },
      'm2'
    );
    await engine.applyMocks([text], 'passthrough');
    const res = await getViaProxy(port!, 'http://img.example.com/logo.png');
    expect(res.body.toString('utf-8')).toBe('héllo');
  }, 15_000);
});
