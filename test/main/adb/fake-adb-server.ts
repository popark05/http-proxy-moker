import * as net from 'node:net';
import { AdbConnection } from '../../../src/main/adb/protocol/connection';
import { AdbStreamOpenException } from '../../../src/main/adb/errors';
import { createReverseOpenHandler } from '../../../src/main/adb/services/reverse';
import { pipeSocketAndStream } from '../../../src/main/adb/services/forward';
import { memoryDevice, type ServiceHandler } from './fake-device';

export interface FakeServerDevice {
  serial: string;
  /** device | unauthorized | offline */
  state: string;
  services?: ServiceHandler;
}

/**
 * 가짜 adb server: 스마트 소켓 프로토콜(4자리 hex 길이 + 요청, OKAY/FAIL 응답)을 말하고,
 * 기기 서비스는 가짜 기기(FakeDevice)에 대한 ADB 연결로 중계한다(실제 adb server와 같은 구조).
 * reverse로 기기가 여는 연결은 서버가 직접 로컬 포트에 붙는다(실제 서버 동작).
 */
export async function startFakeAdbServer(devices: FakeServerDevice[]): Promise<{
  port: number;
  requests: string[];
  close: () => Promise<void>;
}> {
  const requests: string[] = [];
  const connections = new Map<string, Promise<AdbConnection>>();
  const sockets = new Set<net.Socket>();

  const connectionFor = (device: FakeServerDevice): Promise<AdbConnection> => {
    let conn = connections.get(device.serial);
    if (!conn) {
      const { transport } = memoryDevice(device.services ?? (() => undefined));
      conn = AdbConnection.connect(transport).then((c) => {
        c.setOpenHandler(createReverseOpenHandler(() => true));
        return c;
      });
      connections.set(device.serial, conn);
    }
    return conn;
  };

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    void handle(socket);
  });

  async function handle(socket: net.Socket): Promise<void> {
    let buffer = Buffer.alloc(0);
    let waiter: (() => void) | undefined;
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      waiter?.();
    };
    socket.on('data', onData);
    const readExact = async (n: number): Promise<Buffer | null> => {
      while (buffer.length < n) {
        if (socket.destroyed) return null;
        await new Promise<void>((r) => {
          waiter = r;
          socket.once('close', r);
        });
      }
      const out = buffer.subarray(0, n);
      buffer = buffer.subarray(n);
      return out;
    };
    const hex = (s: string): string => Buffer.byteLength(s).toString(16).padStart(4, '0') + s;
    const okay = (value?: string): void => void socket.write(value === undefined ? 'OKAY' : `OKAY${hex(value)}`);
    const fail = (message: string): void => {
      socket.write(`FAIL${hex(message)}`);
      socket.end();
    };

    let transport: FakeServerDevice | undefined;
    for (;;) {
      const len = await readExact(4);
      if (!len) return;
      const request = (await readExact(parseInt(len.toString('ascii'), 16)))?.toString('utf-8');
      if (request === undefined) return;
      requests.push(request);

      if (request === 'host:version') return okay('0029');
      if (request === 'host:devices') {
        return okay(devices.map((d) => `${d.serial}\t${d.state}\n`).join(''));
      }
      if (request.startsWith('host:transport:')) {
        const serial = request.slice('host:transport:'.length);
        const device = devices.find((d) => d.serial === serial);
        if (!device) return fail(`device '${serial}' not found`);
        if (device.state === 'unauthorized') {
          return fail("device unauthorized.\nThis adb server's $ADB_VENDOR_KEYS is not set");
        }
        transport = device;
        okay();
        continue;
      }
      if (!transport) return fail(`unknown host service: ${request}`);
      if (request === 'host:features') {
        return okay([...(await connectionFor(transport)).banner.features].join(','));
      }
      // 기기 서비스: ADB 스트림을 열고 소켓과 잇는다.
      const conn = await connectionFor(transport);
      try {
        const stream = await conn.open(request);
        okay();
        socket.off('data', onData);
        const rest = buffer;
        buffer = Buffer.alloc(0);
        if (rest.length > 0) await stream.write(rest);
        pipeSocketAndStream(socket, stream);
      } catch (e) {
        fail(e instanceof AdbStreamOpenException ? `closed` : String(e));
      }
      return;
    }
  }

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: (server.address() as net.AddressInfo).port,
    requests,
    close: async () => {
      sockets.forEach((s) => s.destroy());
      for (const c of connections.values()) await (await c).close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  };
}
