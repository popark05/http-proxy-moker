// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import { Dadb } from '../../../src/main/adb/dadb';
import { AdbOperationFailedException } from '../../../src/main/adb/results';
import { AdbException } from '../../../src/main/adb/errors';
import { FakeAndroid } from './fake-android';
import { memoryDevice, tcpDevice, type FakeDeviceStream } from './fake-device';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function memDadb(): { dadb: Dadb; phone: FakeAndroid } {
  const phone = new FakeAndroid();
  const { transport } = memoryDevice(phone.services);
  const dadb = new Dadb('mem', async () => transport, { keyPair: null });
  cleanups.push(() => dadb.close());
  return { dadb, phone };
}

/** 호스트 쪽 로컬 서버(프록시 역할). 접속하면 greeting을 보내고, 받은 데이터를 대문자로 돌려준다. */
async function localServer(greeting = ''): Promise<{ port: number; sockets: net.Socket[] }> {
  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    socket.on('error', () => {});
    if (greeting) socket.write(greeting);
    socket.on('data', (d) => socket.write(d.toString().toUpperCase()));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(
    () =>
      new Promise<void>((r) => {
        sockets.forEach((s) => s.destroy());
        server.close(() => r());
      })
  );
  return { port: (server.address() as net.AddressInfo).port, sockets };
}

async function closedPort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

/** 기기 스트림에서 n바이트를 받아 문자열로. */
async function recv(stream: FakeDeviceStream, n: number): Promise<string> {
  return ((await stream.readBytes(n)) ?? Buffer.alloc(0)).toString();
}

const wait = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('Dadb.reverse', () => {
  it('기기 앱의 접속을 호스트 로컬 포트로 중계(양방향)', async () => {
    const { dadb, phone } = memDadb();
    const local = await localServer('hello from proxy\n');
    const rule = await dadb.reverse('tcp:8080', `tcp:${local.port}`);
    expect(rule).toMatchObject({ remote: 'tcp:8080', local: `tcp:${local.port}`, devicePort: 8080 });
    expect(phone.currentReverses().get('tcp:8080')).toBe(`tcp:${local.port}`);

    const app = (await phone.connectReverse(8080))!;
    expect(app).not.toBeNull();
    expect(await recv(app, 17)).toBe('hello from proxy\n');
    await app.send('get /');
    expect(await recv(app, 5)).toBe('GET /');
  });

  it('기기 앱의 동시 접속 여러 개', async () => {
    const { dadb, phone } = memDadb();
    const local = await localServer();
    await dadb.reverse('tcp:8080', `tcp:${local.port}`);
    const apps = await Promise.all([1, 2, 3].map(() => phone.connectReverse(8080)));
    await Promise.all(apps.map((a, i) => a!.send(`client${i}`)));
    expect(await Promise.all(apps.map((a) => recv(a!, 7)))).toEqual(['CLIENT0', 'CLIENT1', 'CLIENT2']);
    expect(local.sockets.length).toBe(3);
  });

  it('tcp:0이면 기기가 고른 포트를 돌려줌', async () => {
    const { dadb, phone } = memDadb();
    const local = await localServer();
    const rule = await dadb.reverse('tcp:0', `tcp:${local.port}`);
    expect(rule.devicePort).toBe(40000);
    expect(rule.remote).toBe('tcp:40000');
    expect(await phone.connectReverse(40000)).not.toBeNull();
  });

  it('로컬 포트에 아무도 없으면 기기 쪽 OPEN을 거부', async () => {
    const { dadb, phone } = memDadb();
    await dadb.reverse('tcp:8080', `tcp:${await closedPort()}`);
    expect(await phone.connectReverse(8080)).toBeNull();
  });

  it('등록하지 않은 목적지로 온 OPEN은 거부', async () => {
    const { dadb, phone } = memDadb();
    const local = await localServer();
    await dadb.reverse('tcp:8080', `tcp:${local.port}`);
    // 다른 클라이언트가 만든 규칙처럼 우리 목록에 없는 local 사양.
    phone.currentReverses().set('tcp:9090', 'tcp:22');
    expect(await phone.connectReverse(9090)).toBeNull();
  });

  it('로컬 소켓이 닫히면 기기 스트림도 닫힘, 기기가 닫으면 로컬 소켓도 닫힘', async () => {
    const { dadb, phone } = memDadb();
    const local = await localServer();
    await dadb.reverse('tcp:8080', `tcp:${local.port}`);

    const a = (await phone.connectReverse(8080))!;
    await wait();
    local.sockets[0].destroy();
    await wait();
    expect(a.hostClosed).toBe(true);

    const b = (await phone.connectReverse(8080))!;
    await wait();
    const closed = new Promise<void>((r) => local.sockets[1].on('close', () => r()));
    b.close();
    await closed;
  });

  it('adbd가 거부하면 AdbOperationFailedException(AdbException 아님)', async () => {
    const { dadb, phone } = memDadb();
    phone.busyRemote = 'tcp:8080';
    const thrown = await dadb.reverse('tcp:8080', 'tcp:1234').catch((e) => e);
    expect(thrown).toBeInstanceOf(AdbOperationFailedException);
    expect(thrown).not.toBeInstanceOf(AdbException);
    expect(thrown.reason).toContain('Address already in use');
  });

  it('norebind: 이미 있는 규칙은 덮어쓰지 않음', async () => {
    const { dadb } = memDadb();
    await dadb.reverse('tcp:8080', 'tcp:1234');
    await expect(dadb.reverse('tcp:8080', 'tcp:5678', { noRebind: true })).rejects.toBeInstanceOf(
      AdbOperationFailedException
    );
  });

  it('호스트 쪽이 tcp:<port>가 아니면 RangeError', async () => {
    const { dadb } = memDadb();
    await expect(dadb.reverse('tcp:8080', 'localabstract:foo')).rejects.toBeInstanceOf(RangeError);
  });

  it('list / close(멱등) / killAll', async () => {
    const { dadb, phone } = memDadb();
    const a = await dadb.reverse('tcp:8080', 'tcp:1111');
    await dadb.reverse('tcp:8081', 'tcp:2222');
    expect(await dadb.listReverse()).toEqual([
      { remote: 'tcp:8080', local: 'tcp:1111' },
      { remote: 'tcp:8081', local: 'tcp:2222' }
    ]);

    await a.close();
    await a.close();
    expect([...phone.currentReverses().keys()]).toEqual(['tcp:8081']);
    await expect(dadb.killReverse('tcp:8080')).rejects.toBeInstanceOf(AdbOperationFailedException);

    await dadb.killAllReverse();
    expect(await dadb.listReverse()).toEqual([]);
  });

  it('연결이 끊기면(adbd가 규칙 삭제) 재연결 시 규칙을 다시 설치', async () => {
    const phone = new FakeAndroid();
    const server = await tcpDevice(phone.services);
    cleanups.push(() => server.close());
    const dadb = Dadb.create('127.0.0.1', server.port, { keyPair: null });
    cleanups.push(() => dadb.close());
    const local = await localServer();

    await dadb.reverse('tcp:8080', `tcp:${local.port}`);
    server.sockets[0].destroy();
    await wait();

    // 다음 작업이 재연결을 일으키고, 새 연결에 규칙이 다시 설치된다.
    await dadb.shell('echo hi');
    expect(server.devices.length).toBe(2);
    expect(phone.reverses.get(server.devices[1])?.get('tcp:8080')).toBe(`tcp:${local.port}`);

    const app = (await phone.connectReverse(8080))!;
    await app.send('ping');
    expect(await recv(app, 4)).toBe('PING');
  });

  it('close한 규칙은 재연결 때 다시 설치하지 않음', async () => {
    const phone = new FakeAndroid();
    const server = await tcpDevice(phone.services);
    cleanups.push(() => server.close());
    const dadb = Dadb.create('127.0.0.1', server.port, { keyPair: null });
    cleanups.push(() => dadb.close());

    const rule = await dadb.reverse('tcp:8080', 'tcp:1111');
    await rule.close();
    server.sockets[0].destroy();
    await wait();
    await dadb.shell('echo hi');
    expect(phone.reverses.get(server.devices[1])?.size ?? 0).toBe(0);
  });
});
