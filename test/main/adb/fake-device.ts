import * as net from 'node:net';
import {
  CMD_CLSE,
  CMD_CNXN,
  CMD_OKAY,
  CMD_OPEN,
  CMD_WRTE
} from '../../../src/main/adb/protocol/constants';
import { MessageDecoder, encodeMessage, type AdbMessage } from '../../../src/main/adb/protocol/message';
import { DEVICE_BANNER, MemoryTransport, msg } from './fake-adbd';

/**
 * 스트림을 이해하는 가짜 adbd(인증 없음). 실제 adbd처럼 흐름 제어를 지킨다:
 * - 기기 → 호스트 WRTE는 호스트의 OKAY를 받아야 다음 WRTE를 보낸다.
 * - 호스트 → 기기 WRTE에는 OKAY로 응답한다(autoAck=false면 테스트가 직접 ack).
 */
export class FakeDeviceStream {
  readonly received: Buffer[] = [];
  hostClosed = false;
  private pendingAck: (() => void) | undefined;
  /** readBytes()용 누적 버퍼. */
  private inbox: Buffer = Buffer.alloc(0);
  private inboxWaiter: (() => void) | undefined;
  private readonly unackedHostWrites: number[] = [];

  constructor(
    readonly device: FakeDevice,
    readonly deviceId: number,
    readonly hostId: number,
    readonly destination: string
  ) {}

  /** 호스트로 데이터를 보내고 호스트의 OKAY를 기다린다. */
  send(data: string | Buffer): Promise<void> {
    return new Promise((resolve) => {
      this.pendingAck = resolve;
      this.device.send(msg(CMD_WRTE, this.deviceId, this.hostId, data));
    });
  }

  close(): void {
    this.device.send(msg(CMD_CLSE, this.deviceId, this.hostId));
  }

  /** 호스트가 보낸 바이트를 정확히 n바이트 읽는다(WRTE 경계와 무관). 호스트가 닫으면 null. */
  async readBytes(n: number): Promise<Buffer | null> {
    while (this.inbox.length < n) {
      if (this.hostClosed) return null;
      await new Promise<void>((resolve) => (this.inboxWaiter = resolve));
    }
    const out = this.inbox.subarray(0, n);
    this.inbox = this.inbox.subarray(n);
    return Buffer.from(out);
  }

  /** 호스트가 스트림을 닫았음을 알린다(FakeDevice가 호출). */
  markHostClosed(): void {
    this.hostClosed = true;
    this.wakeInbox();
  }

  private wakeInbox(): void {
    const w = this.inboxWaiter;
    this.inboxWaiter = undefined;
    w?.();
  }

  /** autoAck=false일 때 받은 호스트 WRTE 하나에 OKAY 응답. */
  ackOne(): void {
    if (this.unackedHostWrites.shift() !== undefined) {
      this.device.send(msg(CMD_OKAY, this.deviceId, this.hostId));
    }
  }

  get unacked(): number {
    return this.unackedHostWrites.length;
  }

  // FakeDevice가 호출
  onHostWrite(payload: Buffer, autoAck: boolean): void {
    this.received.push(payload);
    this.inbox = Buffer.concat([this.inbox, payload]);
    this.wakeInbox();
    if (autoAck) this.device.send(msg(CMD_OKAY, this.deviceId, this.hostId));
    else this.unackedHostWrites.push(this.deviceId);
  }

  onHostOkay(): void {
    const ack = this.pendingAck;
    this.pendingAck = undefined;
    ack?.();
  }
}

/** 서비스 핸들러. undefined를 반환하면 OPEN을 거부(CLSE). */
export type ServiceHandler = (destination: string) => ((stream: FakeDeviceStream) => void) | undefined;

export class FakeDevice {
  readonly streams = new Map<number, FakeDeviceStream>();
  readonly received: AdbMessage[] = [];
  autoAck = true;
  /** 연결(CNXN)을 받으면 응답할 maxPayload. */
  maxPayload = 256 * 1024;
  /** CNXN 배너(features 조정용). */
  banner = DEVICE_BANNER;
  private readonly decoder = new MessageDecoder();
  private nextId = 1000;
  /** 기기가 연 스트림 중 호스트 응답(OKAY/CLSE)을 기다리는 것. */
  private readonly pendingOpens = new Map<number, { destination: string; resolve: (s: FakeDeviceStream | null) => void }>();

  constructor(
    private readonly out: (bytes: Uint8Array) => void,
    private readonly services: ServiceHandler
  ) {}

  feed(bytes: Uint8Array): void {
    for (const message of this.decoder.push(bytes)) {
      this.received.push(message);
      // 실제 기기처럼 비동기 처리.
      queueMicrotask(() => this.handle(message));
    }
  }

  send(message: AdbMessage): void {
    this.out(encodeMessage(message));
  }

  /** 기기가 먼저 스트림을 연다(adb reverse 흉내). 호스트가 OKAY면 스트림, CLSE면 null. */
  openFromDevice(destination: string): Promise<FakeDeviceStream | null> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pendingOpens.set(id, { destination, resolve });
      this.send(msg(CMD_OPEN, id, 0, `${destination}\0`));
    });
  }

  private handle(message: AdbMessage): void {
    switch (message.command) {
      case CMD_CNXN:
        this.send(msg(CMD_CNXN, 0x01000001, this.maxPayload, this.banner));
        return;
      case CMD_OPEN: {
        const destination = message.payload.subarray(0, -1).toString('utf-8');
        const handler = this.services(destination);
        if (!handler) {
          this.send(msg(CMD_CLSE, 0, message.arg0));
          return;
        }
        const stream = new FakeDeviceStream(this, this.nextId++, message.arg0, destination);
        this.streams.set(stream.deviceId, stream);
        this.send(msg(CMD_OKAY, stream.deviceId, message.arg0));
        handler(stream);
        return;
      }
      case CMD_WRTE:
        this.streams.get(message.arg1)?.onHostWrite(message.payload, this.autoAck);
        return;
      case CMD_OKAY: {
        const pending = this.pendingOpens.get(message.arg1);
        if (pending) {
          this.pendingOpens.delete(message.arg1);
          const stream = new FakeDeviceStream(this, message.arg1, message.arg0, pending.destination);
          this.streams.set(stream.deviceId, stream);
          pending.resolve(stream);
          return;
        }
        this.streams.get(message.arg1)?.onHostOkay();
        return;
      }
      case CMD_CLSE: {
        const pending = this.pendingOpens.get(message.arg1);
        if (pending) {
          this.pendingOpens.delete(message.arg1);
          pending.resolve(null);
          return;
        }
        const stream = this.streams.get(message.arg1);
        if (stream) {
          stream.markHostClosed();
          this.streams.delete(message.arg1);
        }
        return;
      }
    }
  }
}

/** 메모리 전송 위의 가짜 기기. */
export function memoryDevice(services: ServiceHandler): { device: FakeDevice; transport: MemoryTransport } {
  let device: FakeDevice | undefined;
  const transport = new MemoryTransport((bytes) => device!.feed(bytes));
  device = new FakeDevice((bytes) => transport.deliver(bytes), services);
  return { device, transport };
}

/** 실제 TCP 포트에서 가짜 adbd를 띄운다. 연결마다 새 FakeDevice. */
export async function tcpDevice(
  services: ServiceHandler,
  configure?: (device: FakeDevice) => void
): Promise<{
  port: number;
  devices: FakeDevice[];
  sockets: net.Socket[];
  close: () => Promise<void>;
}> {
  const devices: FakeDevice[] = [];
  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    const device = new FakeDevice((bytes) => {
      if (!socket.destroyed) socket.write(bytes);
    }, services);
    configure?.(device);
    devices.push(device);
    socket.on('data', (chunk) => device.feed(chunk));
    socket.on('error', () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    devices,
    sockets,
    close: () =>
      new Promise<void>((resolve) => {
        sockets.forEach((s) => s.destroy());
        server.close(() => resolve());
      })
  };
}

/** echo 셸 흉내: "shell:echo X" → "X\n" 출력 후 종료. */
export const echoServices: ServiceHandler = (destination) => {
  const match = /^shell:echo (.*)$/.exec(destination);
  if (!match) return undefined;
  return (stream) => {
    void stream.send(`${match[1]}\n`).then(() => stream.close());
  };
};
