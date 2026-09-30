// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import { TcpTransport } from '../../../src/main/adb/transport/tcp';
import { AdbConnectException, AdbTimeoutException } from '../../../src/main/adb/errors';

let server: net.Server | undefined;
const sockets: net.Socket[] = [];

afterEach(async () => {
  sockets.splice(0).forEach((s) => s.destroy());
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
});

async function listen(onSocket: (socket: net.Socket) => void): Promise<number> {
  server = net.createServer((socket) => {
    sockets.push(socket);
    socket.on('error', () => {});
    onSocket(socket);
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return (server.address() as net.AddressInfo).port;
}

async function closedPort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

describe('TcpTransport', () => {
  // dadb AdbExceptionTest.refusedConnectThrowsAdbConnectException
  it('거부된 연결은 AdbConnectException(원인 보존)', async () => {
    const port = await closedPort();
    const thrown = await TcpTransport.connect('127.0.0.1', port, { connectTimeoutMs: 1000 }).catch(
      (e) => e
    );
    expect(thrown).toBeInstanceOf(AdbConnectException);
    expect(thrown.cause).toBeDefined();
  });

  it('양방향 바이트 전달', async () => {
    const port = await listen((socket) => socket.on('data', (d) => socket.write(d)));
    const transport = await TcpTransport.connect('127.0.0.1', port);
    const received = new Promise<Buffer>((resolve) => transport.onData((c) => resolve(Buffer.from(c))));
    await transport.write(Buffer.from('ping'));
    expect((await received).toString()).toBe('ping');
    await transport.close();
  });

  it('상대가 끊으면 onClose 호출', async () => {
    const port = await listen((socket) => setTimeout(() => socket.destroy(), 10));
    const transport = await TcpTransport.connect('127.0.0.1', port);
    await new Promise<void>((resolve) => transport.onClose(() => resolve()));
  });

  // dadb WriteTimeoutTest "a wedged write fails fast": 상대가 소켓을 비우지 않으면
  // OS 버퍼가 찬 뒤 쓰기가 멈춘다 → 기한 후 AdbTimeoutException + 소켓 종료.
  it('상대가 읽지 않아 쓰기가 멈추면 writeTimeout 후 AdbTimeoutException', async () => {
    const port = await listen((socket) => socket.pause());
    const transport = await TcpTransport.connect('127.0.0.1', port, { writeTimeoutMs: 300 });
    const closed = new Promise<void>((resolve) => transport.onClose(() => resolve()));

    const started = Date.now();
    const thrown = await transport.write(Buffer.alloc(64 * 1024 * 1024)).catch((e) => e);
    expect(thrown).toBeInstanceOf(AdbTimeoutException);
    expect(Date.now() - started).toBeLessThan(5000);
    await closed;
  });
});
