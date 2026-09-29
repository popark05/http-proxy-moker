// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import { Dadb } from '../../../src/main/adb/dadb';
import { AdbConnectException, AdbTimeoutException } from '../../../src/main/adb/errors';
import { echoServices, tcpDevice, type ServiceHandler } from './fake-device';

type Server = Awaited<ReturnType<typeof tcpDevice>>;
let server: Server | undefined;
let dadb: Dadb | undefined;

afterEach(async () => {
  await dadb?.close();
  dadb = undefined;
  await server?.close();
  server = undefined;
});

async function start(services: ServiceHandler = echoServices, readTimeoutMs?: number): Promise<Dadb> {
  server = await tcpDevice(services);
  dadb = Dadb.create('127.0.0.1', server.port, { keyPair: null, readTimeoutMs });
  return dadb;
}

async function shellEcho(d: Dadb, text: string): Promise<string> {
  const stream = await d.open(`shell:echo ${text}`);
  return (await stream.readAll()).toString();
}

describe('Dadb (TCP)', () => {
  it('실제 TCP 소켓으로 핸드셰이크 → 스트림 → 출력', async () => {
    const d = await start();
    expect(await shellEcho(d, 'hello')).toBe('hello\n');
    expect(await d.supportsFeature('shell_v2')).toBe(true);
    expect(d.serial).toBe(`127.0.0.1:${server!.port}`);
  });

  // dadb DadbImplTest.reconnection
  it('연결이 끊기면 다음 작업에서 재연결', async () => {
    const d = await start();
    expect(await shellEcho(d, 'hello1')).toBe('hello1\n');

    server!.sockets[0].destroy();
    await new Promise((r) => setTimeout(r, 20));

    expect(await shellEcho(d, 'hello2')).toBe('hello2\n');
    expect(server!.devices.length).toBe(2);
  });

  it('동시 호출은 연결 하나를 공유', async () => {
    const d = await start();
    const outputs = await Promise.all(['a', 'b', 'c'].map((t) => shellEcho(d, t)));
    expect(outputs).toEqual(['a\n', 'b\n', 'c\n']);
    expect(server!.devices.length).toBe(1);
  });

  // dadb AdbExceptionTest.refusedConnectThrowsAdbConnectException
  it('거부된 연결은 AdbConnectException', async () => {
    const s = net.createServer();
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    const port = (s.address() as net.AddressInfo).port;
    await new Promise<void>((r) => s.close(() => r()));

    dadb = Dadb.create('127.0.0.1', port, { keyPair: null, connectTimeoutMs: 1000 });
    const thrown = await dadb.open('shell:echo hi').catch((e) => e);
    expect(thrown).toBeInstanceOf(AdbConnectException);
    expect(thrown.cause).toBeDefined();
  });

  // dadb WriteTimeoutTest "a wedged read is bounded by socketTimeout"
  it('출력이 오지 않으면 readTimeout 후 AdbTimeoutException', async () => {
    const d = await start((destination) => (destination === 'shell:sleep' ? () => {} : undefined), 100);
    const stream = await d.open('shell:sleep');
    await expect(stream.readAll()).rejects.toBeInstanceOf(AdbTimeoutException);
  });

  it('포트 검증', () => {
    expect(() => Dadb.create('localhost', -1)).toThrow(RangeError);
  });
});

/**
 * 실제 에뮬레이터/기기 대상 통합 테스트. 예:
 *   ADB_TEST_HOST=localhost ADB_TEST_PORT=5555 npx vitest run test/main/adb/dadb.test.ts
 * (adb server가 같은 기기를 잡고 있어도 TCP 5555는 동시 접속 가능)
 */
describe.skipIf(!process.env.ADB_TEST_HOST)('Dadb (실제 adbd)', () => {
  it('shell:echo 왕복', async () => {
    dadb = Dadb.create(process.env.ADB_TEST_HOST!, Number(process.env.ADB_TEST_PORT ?? 5555), {
      connectTimeoutMs: 5000,
      readTimeoutMs: 10_000
    });
    expect(await shellEcho(dadb, 'hello')).toBe('hello\n');
  });

  it('shell v2 / push·pull 왕복', async () => {
    dadb = Dadb.create(process.env.ADB_TEST_HOST!, Number(process.env.ADB_TEST_PORT ?? 5555), {
      connectTimeoutMs: 5000,
      readTimeoutMs: 10_000
    });
    const response = await dadb.shell('echo bénéficiaire; echo err >&2; exit 3');
    expect(response).toMatchObject({ output: 'bénéficiaire\n', errorOutput: 'err\n', exitCode: 3 });

    const remote = '/data/local/tmp/dadb-ts-test';
    const content = Buffer.from(`hello ${Math.random()}`);
    expect(await dadb.push(content, remote)).toEqual({ success: true });
    const chunks: Buffer[] = [];
    expect(await dadb.pull((c) => void chunks.push(c), remote)).toEqual({ success: true });
    expect(Buffer.concat(chunks)).toEqual(content);
    await dadb.shell(`rm -f ${remote}`);
    expect(await dadb.pull(() => {}, remote)).toMatchObject({ success: false });
  });

  it('reverse: 기기의 nc가 호스트 로컬 서버에 닿음', async () => {
    const local = net.createServer((socket) => socket.on('data', (d) => socket.end(d.toString().toUpperCase())));
    await new Promise<void>((r) => local.listen(0, '127.0.0.1', r));
    const localPort = (local.address() as net.AddressInfo).port;
    dadb = Dadb.create(process.env.ADB_TEST_HOST!, Number(process.env.ADB_TEST_PORT ?? 5555), {
      connectTimeoutMs: 5000,
      readTimeoutMs: 10_000
    });
    try {
      const rule = await dadb.reverse('tcp:0', `tcp:${localPort}`);
      const response = await dadb.shell(`echo ping | toybox nc -w 2 127.0.0.1 ${rule.devicePort}`);
      expect(response.output.trim()).toBe('PING');
      await rule.close();
    } finally {
      await new Promise<void>((r) => local.close(() => r()));
    }
  });
});
