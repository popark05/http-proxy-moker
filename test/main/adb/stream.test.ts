// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { AdbConnection } from '../../../src/main/adb/protocol/connection';
import {
  CMD_CLSE,
  CMD_CNXN,
  CMD_OKAY,
  CMD_WRTE
} from '../../../src/main/adb/protocol/constants';
import { encodeMessage } from '../../../src/main/adb/protocol/message';
import {
  AdbConnectionClosedException,
  AdbProtocolException,
  AdbStreamOpenException,
  AdbTimeoutException
} from '../../../src/main/adb/errors';
import { DEVICE_BANNER, FakeAdbd, msg } from './fake-adbd';
import { memoryDevice, type FakeDeviceStream, type ServiceHandler } from './fake-device';

/** 서비스를 열면 테스트가 기기 쪽 스트림을 받아 직접 조작할 수 있게 한다. */
function capture(): { services: ServiceHandler; next: () => Promise<FakeDeviceStream> } {
  const opened: FakeDeviceStream[] = [];
  const waiters: Array<(s: FakeDeviceStream) => void> = [];
  return {
    services: (destination) =>
      destination.startsWith('refuse') ? undefined : (stream) => {
        const w = waiters.shift();
        if (w) w(stream);
        else opened.push(stream);
      },
    next: () => {
      const s = opened.shift();
      return s ? Promise.resolve(s) : new Promise((resolve) => waiters.push(resolve));
    }
  };
}

async function setup(readTimeoutMs?: number) {
  const cap = capture();
  const { device, transport } = memoryDevice(cap.services);
  const conn = await AdbConnection.connect(transport, { readTimeoutMs });
  return { device, transport, conn, next: cap.next };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('AdbConnection.open', () => {
  it('OKAY로 원격 ID를 받고, localId는 1부터 순차 발급', async () => {
    const { conn, next } = await setup();
    const a = await conn.open('svc:a');
    const devA = await next();
    const b = await conn.open('svc:b');
    expect([a.localId, b.localId]).toEqual([1, 2]);
    expect(a.remoteId).toBe(devA.deviceId);
    expect(devA.destination).toBe('svc:a');
  });

  it('adbd가 거부하면 AdbStreamOpenException(destination 포함)이고 연결은 계속 사용 가능', async () => {
    const { conn } = await setup();
    const thrown = await conn.open('refuse:x').catch((e) => e);
    expect(thrown).toBeInstanceOf(AdbStreamOpenException);
    expect(thrown.destination).toBe('refuse:x');
    await expect(conn.open('svc:ok')).resolves.toBeDefined();
    expect(conn.isClosed).toBe(false);
  });

  it('OPEN 응답이 없으면 AdbTimeoutException', async () => {
    const adbd = new FakeAdbd((m) =>
      m.command === CMD_CNXN ? [msg(CMD_CNXN, 0x01000001, 4096, DEVICE_BANNER)] : []
    );
    const conn = await AdbConnection.connect(adbd.transport);
    await expect(conn.open('shell:', 20)).rejects.toBeInstanceOf(AdbTimeoutException);
  });
});

describe('AdbStream 수신', () => {
  // dadb AdbStreamTest.testLargeRemoteWrite
  it('큰 WRTE(1MB)를 그대로 읽음', async () => {
    const { conn, next } = await setup();
    const stream = await conn.open('svc:big');
    const dev = await next();
    const payload = Buffer.alloc(1024 * 1024, 1);
    void dev.send(payload).then(() => dev.close());
    // toEqual은 1MB Buffer를 원소 단위로 비교해 수 초가 걸리므로 equals로 비교.
    expect((await stream.readAll()).equals(payload)).toBe(true);
  });

  // dadb AdbStreamTest.peerCloseIsCleanEof
  it('원격 CLSE는 예외가 아닌 EOF', async () => {
    const { conn, next } = await setup();
    const stream = await conn.open('svc:x');
    (await next()).close();
    expect(await stream.readAll()).toEqual(Buffer.alloc(0));
  });

  it('원격 CLSE 전에 받은 데이터는 끝까지 읽힘', async () => {
    const { conn, next, device } = await setup();
    const stream = await conn.open('svc:x');
    const dev = await next();
    // OKAY를 기다리지 않고 WRTE 직후 CLSE를 보내는 기기.
    device.send(msg(CMD_WRTE, dev.deviceId, stream.localId, 'tail'));
    dev.close();
    await tick();
    expect((await stream.readAll()).toString()).toBe('tail');
  });

  it('소비(read)하기 전에는 OKAY를 보내지 않음(역압)', async () => {
    const { conn, next, device } = await setup();
    const stream = await conn.open('svc:x');
    const dev = await next();
    const sent = dev.send('one');
    await tick();
    const okays = () =>
      device.received.filter((m) => m.command === CMD_OKAY && m.arg0 === stream.localId).length;
    expect(okays()).toBe(0);

    expect((await stream.read())?.toString()).toBe('one');
    await sent;
    expect(okays()).toBe(1);
  });

  // dadb MessageQueueTest.multipleTypes / concurrency_ordering
  it('여러 스트림의 메시지가 섞여 도착해도 각자 순서대로 라우팅', async () => {
    const { conn, next } = await setup();
    const a = await conn.open('svc:a');
    const devA = await next();
    const b = await conn.open('svc:b');
    const devB = await next();

    const N = 200;
    void (async () => {
      for (let i = 0; i < N; i++) await devA.send(`a${i};`);
      devA.close();
    })();
    void (async () => {
      for (let i = 0; i < N; i++) await devB.send(`b${i};`);
      devB.close();
    })();

    const [outA, outB] = await Promise.all([a.readAll(), b.readAll()]);
    expect(outA.toString()).toBe(Array.from({ length: N }, (_, i) => `a${i};`).join(''));
    expect(outB.toString()).toBe(Array.from({ length: N }, (_, i) => `b${i};`).join(''));
  });

  // dadb MessageQueueFailureContractTest의 "실패가 sticky하지 않음"에 대응(스트림 단위 타임아웃)
  it('읽기 타임아웃은 그 호출만 실패시키고 이후 데이터는 계속 읽힘', async () => {
    const { conn, next } = await setup();
    const stream = await conn.open('svc:x');
    const dev = await next();
    await expect(stream.read(20)).rejects.toBeInstanceOf(AdbTimeoutException);
    void dev.send('late');
    expect((await stream.read(1000))?.toString()).toBe('late');
  });

  // dadb MessageQueueTest.take_afterStopListening
  it('로컬로 닫은 스트림의 read는 EOF(예외 아님)', async () => {
    const { conn, next } = await setup();
    const stream = await conn.open('svc:x');
    const dev = await next();
    const pending = stream.read();
    await stream.close();
    await expect(pending).resolves.toBeNull();
    await expect(stream.read()).resolves.toBeNull();
    await tick();
    expect(dev.hostClosed).toBe(true);
  });
});

describe('AdbStream 송신', () => {
  it('maxPayload 단위로 나누고 조각마다 기기의 OKAY를 기다림', async () => {
    const cap = capture();
    const { device, transport } = memoryDevice(cap.services);
    device.maxPayload = 16;
    device.autoAck = false;
    const conn = await AdbConnection.connect(transport);
    const stream = await conn.open('svc:x');
    const dev = await cap.next();

    const data = Buffer.from('x'.repeat(16 * 3 + 5));
    let done = false;
    const writing = stream.write(data).then(() => (done = true));

    for (let i = 1; i <= 4; i++) {
      await tick();
      expect(dev.received.length).toBe(i); // OKAY 전에는 다음 WRTE를 보내지 않음
      expect(done).toBe(false);
      dev.ackOne();
    }
    await writing;
    expect(dev.received.map((b) => b.length)).toEqual([16, 16, 16, 5]);
    expect(Buffer.concat(dev.received)).toEqual(data);
  });

  it('같은 스트림의 동시 write는 순서대로 직렬화', async () => {
    const { conn, next } = await setup();
    const stream = await conn.open('svc:x');
    const dev = await next();
    await Promise.all([stream.write(Buffer.from('first')), stream.write(Buffer.from('second'))]);
    expect(dev.received.map(String)).toEqual(['first', 'second']);
  });

  it('OKAY 대기 중 원격이 닫으면 write는 AdbConnectionClosedException', async () => {
    const cap = capture();
    const { device, transport } = memoryDevice(cap.services);
    device.autoAck = false;
    const conn = await AdbConnection.connect(transport);
    const stream = await conn.open('svc:x');
    const dev = await cap.next();
    const writing = stream.write(Buffer.from('data'));
    await tick();
    dev.close();
    await expect(writing).rejects.toBeInstanceOf(AdbConnectionClosedException);
    await expect(stream.write(Buffer.from('more'))).rejects.toBeInstanceOf(
      AdbConnectionClosedException
    );
  });

  it('원격 종료에는 CLSE로 응답(한 번만)', async () => {
    const { conn, next, device } = await setup();
    const stream = await conn.open('svc:x');
    (await next()).close();
    await stream.readAll();
    await stream.close();
    await tick();
    const closes = device.received.filter((m) => m.command === CMD_CLSE && m.arg0 === stream.localId);
    expect(closes.length).toBe(1);
  });
});

describe('연결 실패 계약', () => {
  // dadb MessageQueueFailureContractTest / MessageQueueLostWakeupTest:
  // 연결이 죽으면 대기 중인 모든 작업(여러 스트림의 read/write/open)이 깨어나 오류를 받는다.
  it('연결이 끊기면 모든 대기 작업이 AdbConnectionClosedException', async () => {
    const cap = capture();
    const { device, transport } = memoryDevice(cap.services);
    device.autoAck = false;
    const conn = await AdbConnection.connect(transport);
    const a = await conn.open('svc:a');
    const b = await conn.open('svc:b');
    await cap.next();
    await cap.next();

    const pending = [a.read(), a.read(), b.read(), b.write(Buffer.from('stuck'))];
    await tick();
    transport.remoteClose(new Error('reset'));

    const results = await Promise.allSettled(pending);
    for (const r of results) {
      expect(r.status).toBe('rejected');
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(AdbConnectionClosedException);
    }
    expect(conn.isClosed).toBe(true);
    await expect(conn.open('svc:c')).rejects.toBeInstanceOf(AdbConnectionClosedException);
  });

  // dadb "closing the queue wakes every parked taker"
  it('connection.close()는 대기 중인 read를 모두 깨움', async () => {
    const { conn } = await setup();
    const streams = await Promise.all([conn.open('svc:a'), conn.open('svc:b')]);
    const pending = streams.map((s) => s.read());
    await conn.close();
    for (const r of await Promise.allSettled(pending)) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(AdbConnectionClosedException);
    }
  });

  it('잘못된 패킷이 오면 AdbProtocolException으로 연결 종료', async () => {
    const { conn, transport } = await setup();
    const stream = await conn.open('svc:x');
    const pending = stream.read();
    transport.deliver(Buffer.alloc(24, 0x01));
    await expect(pending).rejects.toBeInstanceOf(AdbProtocolException);
    expect(conn.isClosed).toBe(true);
    expect(transport.closed).toBe(true);
  });

  it('세션 중 CNXN(기기 재시작 등)은 AdbProtocolException', async () => {
    const { conn, transport } = await setup();
    const stream = await conn.open('svc:x');
    const pending = stream.read();
    transport.deliver(encodeMessage(msg(CMD_CNXN, 0x01000001, 4096, DEVICE_BANNER)));
    await expect(pending).rejects.toBeInstanceOf(AdbProtocolException);
  });

  it('기기가 여는 스트림(reverse)은 아직 거부(CLSE)', async () => {
    const { conn, device } = await setup();
    const id = device.openFromDevice('tcp:8080');
    await tick();
    await tick();
    const reply = device.received.find((m) => m.command === CMD_CLSE && m.arg1 === id);
    expect(reply?.arg0).toBe(0);
    expect(conn.isClosed).toBe(false);
  });
});
