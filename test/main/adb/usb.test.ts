// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import { Dadb } from '../../../src/main/adb/dadb';
import { UsbTransport, accessHint, findAdbInterface } from '../../../src/main/adb/transport/usb';
import { listUsbAdbDevices } from '../../../src/main/adb/transport/usb-discovery';
import {
  AdbConnectException,
  AdbConnectionClosedException,
  AdbTimeoutException,
  AdbUsbAccessException
} from '../../../src/main/adb/errors';
import { FakeAndroid } from './fake-android';
import { FakeUsbBackend, FakeUsbDevice } from './fake-usb';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function setup(options: { idlePollMs?: number; writeTimeoutMs?: number } = {}) {
  const phone = new FakeAndroid();
  const usbDevice = new FakeUsbDevice(phone.services);
  const backend = new FakeUsbBackend([usbDevice]);
  const dadb = Dadb.fromUsb('FAKE123', {
    keyPair: null,
    usbBackend: backend,
    writeTimeoutMs: options.writeTimeoutMs,
    usb: { idlePollMs: options.idlePollMs ?? 50 },
    // 테스트가 실제 adb server(5037)에 닿지 않도록. 대체 경로는 adb-server.test.ts에서 검증.
    adbServerFallback: false
  });
  cleanups.push(() => dadb.close());
  return { phone, usbDevice, backend, dadb };
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('findAdbInterface / listUsbAdbDevices', () => {
  it('MTP 등 다른 인터페이스 사이에서 ADB 인터페이스(0xff/0x42/0x01)와 bulk 엔드포인트를 찾음', () => {
    const device = new FakeUsbDevice(() => undefined);
    expect(findAdbInterface(device)).toEqual({
      configurationValue: 1,
      needsConfiguration: false,
      interfaceNumber: 1,
      alternateSetting: 0,
      inEndpoint: 1,
      outEndpoint: 2,
      packetSize: 512
    });
  });

  it('구성이 선택되지 않은 기기(macOS 0xEF 등)는 전체 구성 목록에서 찾고 선택 필요로 표시', () => {
    const device = new FakeUsbDevice(() => undefined);
    device.configurationSelected = false;
    expect(findAdbInterface(device)).toMatchObject({
      configurationValue: 1,
      needsConfiguration: true,
      interfaceNumber: 1
    });
  });

  it('ADB 인터페이스가 없거나 configuration을 읽을 수 없으면 undefined', () => {
    const noAdb = new FakeUsbDevice(() => undefined);
    noAdb.hasAdb = false;
    const locked = new FakeUsbDevice(() => undefined);
    locked.configurationThrows = true;
    expect(findAdbInterface(noAdb)).toBeUndefined();
    expect(findAdbInterface(locked)).toBeUndefined();
  });

  it('ADB 기기만 나열, 시리얼이 없으면 버스 위치로 식별', async () => {
    const a = new FakeUsbDevice(() => undefined, 'SERIAL_A');
    const keyboard = new FakeUsbDevice(() => undefined, 'KBD');
    keyboard.hasAdb = false;
    const noSerial = Object.assign(new FakeUsbDevice(() => undefined, null), { bus: '1-2', address: 7 });
    const list = await listUsbAdbDevices(new FakeUsbBackend([a, keyboard, noSerial]));
    expect(list.map((d) => d.serial)).toEqual(['SERIAL_A', 'usb:1-2-7']);
    expect(list[0]).toMatchObject({ vendorId: 0x18d1, productName: 'Fake Pixel' });
  });

  it('Dadb.list: USB 기기(에뮬레이터 제외 옵션)', async () => {
    const backend = new FakeUsbBackend([new FakeUsbDevice(() => undefined, 'A'), new FakeUsbDevice(() => undefined, 'B')]);
    const list = await Dadb.list({
      usbBackend: backend,
      includeEmulators: false,
      includeAdbServer: false,
      keyPair: null
    });
    expect(list.map((d) => d.serial)).toEqual(['A', 'B']);
  });
});

describe('UsbTransport + Dadb.fromUsb', () => {
  it('인터페이스를 점유하고 halt를 지운 뒤 shell 왕복', async () => {
    const { dadb, usbDevice } = setup();
    expect((await dadb.shell('echo hello')).output).toBe('hello\n');
    expect(usbDevice.claimed.has(1)).toBe(true);
    expect(usbDevice.clearedHalts).toEqual(['in1', 'out2']);
  });

  it('큰 push/pull(3MB): payload가 패킷 크기 배수여도 잘림·교착 없이 전송', async () => {
    const { dadb, phone, usbDevice } = setup();
    const content = crypto.randomBytes(3 * 1024 * 1024 + 123);
    expect((await dadb.push(content, '/data/local/tmp/big')).success).toBe(true);
    expect(phone.files.get('/data/local/tmp/big')!.data.equals(content)).toBe(true);

    const chunks: Buffer[] = [];
    expect((await dadb.pull((c) => void chunks.push(c), '/data/local/tmp/big')).success).toBe(true);
    expect(Buffer.concat(chunks).equals(content)).toBe(true);
    expect(usbDevice.truncatedBytes).toBe(0);
  });

  it('기기가 ZLP 없이 패킷 크기 배수 payload(512/4096)를 보내도 교착 없이 받음', async () => {
    // 큰 버퍼로 뭉뚱그려 읽으면 전송이 끝나지 않고, 기기는 우리 OKAY를 기다려 교착된다.
    const usbDevice = new FakeUsbDevice((destination) => {
      const m = /^blob:(\d+)$/.exec(destination);
      return m ? (s) => void s.send(Buffer.alloc(Number(m[1]), 7)).then(() => s.close()) : undefined;
    });
    const dadb = Dadb.fromUsb('FAKE123', {
      keyPair: null,
      usbBackend: new FakeUsbBackend([usbDevice]),
      usb: { idlePollMs: 50, payloadTimeoutMs: 500 }
    });
    cleanups.push(() => dadb.close());
    for (const size of [512, 4096, 1024 * 3]) {
      const out = await (await dadb.open(`blob:${size}`)).readAll(2000);
      expect(out.length).toBe(size);
    }
    expect(usbDevice.truncatedBytes).toBe(0);
  });

  it('패킷 크기 배수 길이의 쓰기 뒤에는 ZLP(길이 0 전송)를 보냄', async () => {
    const { dadb, usbDevice } = setup();
    // 256KB(= maxPayload, 512의 배수) WRTE가 생기도록 큰 데이터를 보낸다.
    await dadb.push(crypto.randomBytes(600_000), '/data/local/tmp/z');
    const transfers = usbDevice.outTransfers;
    const zlpAfter = transfers.flatMap((len, i) => (transfers[i + 1] === 0 ? [len] : []));
    expect(zlpAfter.length).toBeGreaterThan(0);
    expect(zlpAfter.every((len) => len > 0 && len % 512 === 0)).toBe(true);
    // 배수가 아닌 전송 뒤에는 ZLP가 없다.
    transfers.forEach((len, i) => {
      if (len % 512 !== 0) expect(transfers[i + 1]).not.toBe(0);
    });
  });

  it('유휴 상태에서는 헤더 읽기를 재시도하고, 이후 데이터도 정상 수신', async () => {
    const { dadb, usbDevice } = setup({ idlePollMs: 20 });
    await dadb.shell('echo a');
    await wait(120);
    expect(usbDevice.cancelledReads).toBeGreaterThan(2);
    expect((await dadb.shell('echo b')).output).toBe('b\n');
    expect(usbDevice.truncatedBytes).toBe(0);
  });

  it('다른 프로그램이 인터페이스를 점유 중이면 AdbUsbAccessException(adb kill-server 안내)', async () => {
    const { usbDevice } = setup();
    usbDevice.claimError = new Error('claimInterface error: Busy');
    // adb server 대체 경로를 끈 상태에서 원래 오류가 그대로 나오는지.
    const dadb = Dadb.fromUsb('FAKE123', {
      keyPair: null,
      usbBackend: new FakeUsbBackend([usbDevice]),
      adbServerFallback: false,
      usb: { claimRetries: 0 }
    });
    cleanups.push(() => dadb.close());
    const thrown = await dadb.shell('echo x').catch((e) => e);
    expect(thrown).toBeInstanceOf(AdbUsbAccessException);
    expect(thrown).toBeInstanceOf(AdbConnectException);
    expect(thrown.message).toContain('adb kill-server');
    expect(usbDevice.opened).toBe(false);
  });

  it('구성이 선택되지 않은 기기는 열 때 구성을 선택하고 연결', async () => {
    const { dadb, usbDevice } = setup();
    usbDevice.configurationSelected = false;
    expect((await dadb.shell('echo configured')).output).toBe('configured\n');
    expect(usbDevice.selectedConfigurations).toEqual([1]);
  });

  it('점유가 일시적으로 실패하면 claimRetries만큼 재시도(Windows 인터페이스 준비 지연)', async () => {
    const phone = new FakeAndroid();
    const usbDevice = new FakeUsbDevice(phone.services);
    usbDevice.claimFailures = 2;
    const transport = await UsbTransport.open(usbDevice, { claimRetries: 2, idlePollMs: 20 });
    expect(usbDevice.claimed.has(1)).toBe(true);
    await transport.close();

    usbDevice.claimFailures = 1;
    await expect(UsbTransport.open(usbDevice, { claimRetries: 0 })).rejects.toBeInstanceOf(AdbUsbAccessException);
  });

  it('점유 실패 안내는 Windows에서 WinUSB 드라이버를 함께 안내', () => {
    expect(accessHint('darwin')).toContain('adb kill-server');
    expect(accessHint('darwin')).not.toContain('WinUSB');
    expect(accessHint('win32')).toContain('WinUSB');
    expect(accessHint('win32')).toContain('adb kill-server');
  });

  it('시리얼로 기기를 찾지 못하면 AdbConnectException', async () => {
    const { dadb, backend } = setup();
    backend.devices = [];
    await expect(dadb.shell('echo x')).rejects.toBeInstanceOf(AdbConnectException);
  });

  it('케이블을 뽑으면 대기 작업이 실패하고, 다시 꽂으면 다음 작업에서 재연결', async () => {
    const { dadb, usbDevice, backend, phone } = setup();
    const sh = await dadb.openShell();
    const pending = sh.read();
    usbDevice.unplug();
    await expect(pending).rejects.toBeInstanceOf(AdbConnectionClosedException);

    // 재연결: 같은 시리얼의 새 USBDevice 객체.
    backend.devices = [new FakeUsbDevice(phone.services)];
    expect((await dadb.shell('echo back')).output).toBe('back\n');
  });

  it('쓰기가 멈추면 writeTimeout 후 AdbTimeoutException', async () => {
    const { dadb, usbDevice } = setup({ writeTimeoutMs: 50 });
    await dadb.shell('echo warmup');
    usbDevice.stallWrites = true;
    await expect(dadb.shell('echo x')).rejects.toBeInstanceOf(AdbTimeoutException);
  });

  it('close는 읽기 루프를 멈추고 인터페이스를 놓고 기기를 닫음', async () => {
    const phone = new FakeAndroid();
    const usbDevice = new FakeUsbDevice(phone.services);
    const transport = await UsbTransport.open(usbDevice, { idlePollMs: 20 });
    let closed = false;
    transport.onClose(() => (closed = true));

    await transport.close();
    expect(closed).toBe(true);
    expect(usbDevice.claimed.size).toBe(0);
    expect(usbDevice.opened).toBe(false);
    const calls = usbDevice.transferInCalls;
    await wait(60);
    expect(usbDevice.transferInCalls).toBe(calls);
  });

  it('reverse도 USB 위에서 동작', async () => {
    const { dadb, phone } = setup();
    const net = await import('node:net');
    const sockets: import('node:net').Socket[] = [];
    const server = net.createServer((s) => {
      sockets.push(s);
      s.on('error', () => {});
      s.on('data', (d) => s.write(d.toString().toUpperCase()));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    cleanups.push(
      () =>
        new Promise<void>((r) => {
          sockets.forEach((s) => s.destroy());
          server.close(() => r());
        })
    );
    const port = (server.address() as import('node:net').AddressInfo).port;

    await dadb.reverse('tcp:8080', `tcp:${port}`);
    const app = (await phone.connectReverse(8080))!;
    await app.send('via usb');
    expect((await app.readBytes(7))?.toString()).toBe('VIA USB');
  });
});
