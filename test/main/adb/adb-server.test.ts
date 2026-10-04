// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as net from 'node:net';
import { Dadb } from '../../../src/main/adb/dadb';
import {
  AdbServerSession,
  adbServerPort,
  isAdbServerRunning,
  listAdbServerDevices
} from '../../../src/main/adb/transport/adb-server';
import {
  AdbAuthException,
  AdbConnectException,
  AdbStreamOpenException,
  AdbUsbAccessException
} from '../../../src/main/adb/errors';
import { FakeAndroid } from './fake-android';
import { startFakeAdbServer } from './fake-adb-server';
import { FakeUsbBackend, FakeUsbDevice } from './fake-usb';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function server(phone = new FakeAndroid()) {
  const s = await startFakeAdbServer([
    { serial: 'PHONE1', state: 'device', services: phone.services },
    { serial: 'LOCKED', state: 'unauthorized' },
    { serial: '192.168.0.9:5555', state: 'device', services: new FakeAndroid().services }
  ]);
  cleanups.push(() => s.close());
  return { ...s, phone };
}

async function closedPort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

describe('adb server 클라이언트', () => {
  it('실행 여부와 기기 목록', async () => {
    const { port } = await server();
    expect(await isAdbServerRunning({ port })).toBe(true);
    expect(await isAdbServerRunning({ port: await closedPort() })).toBe(false);
    expect(await listAdbServerDevices({ port })).toEqual([
      { serial: 'PHONE1', state: 'device' },
      { serial: 'LOCKED', state: 'unauthorized' },
      { serial: '192.168.0.9:5555', state: 'device' }
    ]);
  });

  it('포트는 ANDROID_ADB_SERVER_PORT를 따른다(adb와 동일)', () => {
    const before = process.env.ANDROID_ADB_SERVER_PORT;
    try {
      delete process.env.ANDROID_ADB_SERVER_PORT;
      expect(adbServerPort()).toBe(5037);
      process.env.ANDROID_ADB_SERVER_PORT = '5039';
      expect(adbServerPort()).toBe(5039);
    } finally {
      if (before === undefined) delete process.env.ANDROID_ADB_SERVER_PORT;
      else process.env.ANDROID_ADB_SERVER_PORT = before;
    }
  });

  it('세션: host:transport → 서비스, 기능 목록', async () => {
    const { port, requests } = await server();
    const session = await AdbServerSession.connect('PHONE1', { port });
    expect(session.kind).toBe('server');
    expect(session.supportsFeature('shell_v2')).toBe(true);
    expect(requests).toEqual(['host:transport:PHONE1', 'host:features']);
  });

  it('없는 기기는 AdbConnectException, 미인증은 AdbAuthException', async () => {
    const { port } = await server();
    await expect(AdbServerSession.connect('NOPE', { port })).rejects.toBeInstanceOf(AdbConnectException);
    await expect(AdbServerSession.connect('LOCKED', { port })).rejects.toBeInstanceOf(AdbAuthException);
  });

  it('기기가 거부한 서비스는 AdbStreamOpenException', async () => {
    const { port } = await server();
    const session = await AdbServerSession.connect('PHONE1', { port });
    await expect(session.open('nonexistent:')).rejects.toBeInstanceOf(AdbStreamOpenException);
  });
});

describe('Dadb.fromAdbServer (서버 경유 서비스)', () => {
  it('shell / push·pull / install이 같은 서비스 코드로 동작', async () => {
    const { port, phone } = await server();
    const dadb = Dadb.fromAdbServer('PHONE1', { adbServer: { port } });
    cleanups.push(() => dadb.close());

    expect(await dadb.shell('echo via server')).toMatchObject({ output: 'via server\n', exitCode: 0 });
    expect(dadb.connectionKind).toBe('server');

    const content = crypto.randomBytes(700_000);
    expect(await dadb.push(content, '/data/local/tmp/s')).toEqual({ success: true });
    const chunks: Buffer[] = [];
    expect(await dadb.pull((c) => void chunks.push(c), '/data/local/tmp/s')).toEqual({ success: true });
    expect(Buffer.concat(chunks).equals(content)).toBe(true);

    expect(await dadb.install(Buffer.concat([Buffer.from('PK'), crypto.randomBytes(5000)]))).toEqual({
      success: true
    });
    expect(phone.packages.has('com.example.app')).toBe(true);
  });

  it('reverse: 규칙 설치는 서버 경유, 기기→호스트 연결은 서버가 처리', async () => {
    const { port, phone } = await server();
    const dadb = Dadb.fromAdbServer('PHONE1', { adbServer: { port } });
    cleanups.push(() => dadb.close());
    const local = net.createServer((s) => {
      s.on('error', () => {});
      s.on('data', (d) => s.write(d.toString().toUpperCase()));
    });
    await new Promise<void>((r) => local.listen(0, '127.0.0.1', r));
    const sockets: net.Socket[] = [];
    local.on('connection', (s) => sockets.push(s));
    cleanups.push(() => new Promise<void>((r) => { sockets.forEach((s) => s.destroy()); local.close(() => r()); }));

    const rule = await dadb.reverse('tcp:8080', `tcp:${(local.address() as net.AddressInfo).port}`);
    expect(rule.devicePort).toBe(8080);
    const app = (await phone.connectReverse(8080))!;
    await app.send('via server');
    expect((await app.readBytes(10))?.toString()).toBe('VIA SERVER');
  });

  it('Dadb.list: 기본값에서는 서버 기기를 포함하지 않는다', async () => {
    const { port } = await server();
    const list = await Dadb.list({
      usbBackend: new FakeUsbBackend([new FakeUsbDevice(() => undefined, 'PHONE1')]),
      includeEmulators: false,
      adbServer: { port }
    });
    expect(list.map((d) => d.serial)).toEqual(['PHONE1']);
  });

  it('Dadb.list: 서버에만 보이는 기기를 추가(같은 시리얼은 USB 직접 우선)', async () => {
    const { port } = await server();
    const list = await Dadb.list({
      usbBackend: new FakeUsbBackend([new FakeUsbDevice(() => undefined, 'PHONE1')]),
      includeEmulators: false,
      includeAdbServer: true,
      adbServer: { port }
    });
    expect(list.map((d) => d.serial)).toEqual(['PHONE1', 'LOCKED', '192.168.0.9:5555']);
  });
});

describe('USB 점유 실패 → adb server 대체', () => {
  function busyUsb(phone: FakeAndroid) {
    const usbDevice = new FakeUsbDevice(phone.services, 'PHONE1');
    usbDevice.claimError = new Error('claimInterface error: Busy');
    return { usbDevice, backend: new FakeUsbBackend([usbDevice]) };
  }

  it('USB를 직접 못 열면 서버를 경유하고, 서버가 놓아 주면 다음 연결은 다시 직접', async () => {
    const phone = new FakeAndroid();
    const { port } = await server(phone);
    const { usbDevice, backend } = busyUsb(phone);
    const dadb = Dadb.fromUsb('PHONE1', { keyPair: null, usbBackend: backend, adbServer: { port }, adbServerFallback: true, usb: { claimRetries: 0, idlePollMs: 20 } });
    cleanups.push(() => dadb.close());

    expect((await dadb.shell('echo fallback')).output).toBe('fallback\n');
    expect(dadb.connectionKind).toBe('server');

    // adb server 종료 흉내: 인터페이스가 풀리면 재연결 시 직접 연결로 돌아온다.
    usbDevice.claimError = undefined;
    await dadb.close();
    expect((await dadb.shell('echo direct')).output).toBe('direct\n');
    expect(dadb.connectionKind).toBe('direct');
  });

  it('서버가 없으면 원래 USB 오류(안내 포함)를 그대로', async () => {
    const phone = new FakeAndroid();
    const { backend } = busyUsb(phone);
    const dadb = Dadb.fromUsb('PHONE1', { keyPair: null, usbBackend: backend, adbServer: { port: await closedPort() }, adbServerFallback: true, usb: { claimRetries: 0 } });
    cleanups.push(() => dadb.close());
    const thrown = await dadb.shell('echo x').catch((e) => e);
    expect(thrown).toBeInstanceOf(AdbUsbAccessException);
    expect(thrown.message).toContain('adb kill-server');
  });

  it('adbServerFallback 기본값(꺼짐)이면 대체하지 않음', async () => {
    const phone = new FakeAndroid();
    const { port } = await server(phone);
    const { backend } = busyUsb(phone);
    const dadb = Dadb.fromUsb('PHONE1', { keyPair: null, usbBackend: backend, adbServer: { port }, usb: { claimRetries: 0 } });
    cleanups.push(() => dadb.close());
    await expect(dadb.shell('echo x')).rejects.toBeInstanceOf(AdbUsbAccessException);
  });

  it('USB 인증 오류 등 점유 실패가 아닌 오류는 대체하지 않음', async () => {
    const phone = new FakeAndroid();
    const { port, requests } = await server(phone);
    const backend = new FakeUsbBackend([]); // 기기 없음 → AdbConnectException(점유 실패 아님)
    const dadb = Dadb.fromUsb('PHONE1', { keyPair: null, usbBackend: backend, adbServer: { port }, adbServerFallback: true });
    cleanups.push(() => dadb.close());
    const thrown = await dadb.shell('echo x').catch((e) => e);
    expect(thrown).toBeInstanceOf(AdbConnectException);
    expect(thrown).not.toBeInstanceOf(AdbUsbAccessException);
    expect(requests).toEqual([]);
  });
});
