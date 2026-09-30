/**
 * 실행 중인 adb server(기본 127.0.0.1:5037)를 경유하는 세션. dadb adbserver/AdbServer 이식
 * (Apache-2.0, NOTICE 참고).
 *
 * 쓰임: adb server(Android Studio가 띄운 것 포함)가 USB 기기를 이미 점유하면 우리가 직접 USB를
 * 열 수 없다. 이때 서버를 거쳐 같은 서비스를 쓴다(QA PC에 Android Studio가 켜져 있는 흔한 상황).
 *
 * 스마트 소켓 프로토콜: 요청은 "<4자리 hex 길이><문자열>", 응답은 "OKAY" 또는 "FAIL<hex 길이><메시지>".
 * 스트림마다 소켓을 하나 열어 `host:transport:<serial>` → `<service>`를 보낸 뒤, 소켓 바이트가 곧 스트림이다.
 * reverse의 기기→호스트 연결은 adb server가 직접 처리한다.
 */

import * as net from 'node:net';
import type { AdbSession, AdbStreamLike } from '../protocol/session';
import { StreamReader } from '../protocol/stream-io';
import {
  AdbAuthException,
  AdbConnectException,
  AdbConnectionClosedException,
  AdbProtocolException,
  AdbStreamOpenException,
  AdbTimeoutException
} from '../errors';

export interface AdbServerOptions {
  host?: string;
  /** 기본: ANDROID_ADB_SERVER_PORT 환경변수(adb와 동일) 또는 5037. */
  port?: number;
  connectTimeoutMs?: number;
  /** 스트림 읽기 기본 대기(ms). 0이면 무제한. */
  readTimeoutMs?: number;
  /** 소켓 쓰기 정체 기한(ms). 기본 10초. */
  writeTimeoutMs?: number;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_CONNECT_TIMEOUT = 2_000;
const DEFAULT_WRITE_TIMEOUT = 10_000;
/** 소켓 스트림은 WRTE 단위가 없으므로 쓰기를 모으는 크기만 의미가 있다. */
const SOCKET_CHUNK = 256 * 1024;
/** 읽히지 않은 수신 데이터가 이만큼 쌓이면 소켓 읽기를 멈춘다(역압). */
const HIGH_WATER = 1024 * 1024;

export function adbServerPort(): number {
  const fromEnv = Number(process.env.ANDROID_ADB_SERVER_PORT);
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : 5037;
}

function resolved(options: AdbServerOptions): Required<AdbServerOptions> {
  return {
    host: options.host ?? DEFAULT_HOST,
    port: options.port ?? adbServerPort(),
    connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT,
    readTimeoutMs: options.readTimeoutMs ?? 0,
    writeTimeoutMs: options.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT
  };
}

/** adb server 소켓 하나를 AdbStreamLike로 감싼다. */
export class AdbServerStream implements AdbStreamLike {
  readonly maxPayloadSize = SOCKET_CHUNK;
  private readonly queue: Buffer[] = [];
  private queuedBytes = 0;
  private readonly readers: Array<{
    resolve: (b: Buffer | null) => void;
    reject: (e: Error) => void;
    timer?: ReturnType<typeof setTimeout>;
  }> = [];
  private ended = false;
  private closed = false;
  private failure: Error | undefined;

  constructor(
    private readonly socket: net.Socket,
    public destination: string,
    private readonly readTimeoutMs: number,
    private readonly writeTimeoutMs: number
  ) {
    socket.on('data', (chunk: Buffer) => this.push(chunk));
    socket.on('end', () => {
      this.ended = true;
      if (this.queue.length === 0) this.settleReaders(null);
    });
    socket.on('error', (e) => this.fail(new AdbConnectionClosedException('adb server 연결이 끊겼습니다.', e)));
    socket.on('close', () => {
      if (!this.ended && !this.closed) this.fail(new AdbConnectionClosedException('adb server 연결이 끊겼습니다.'));
    });
  }

  get isClosed(): boolean {
    return this.closed || this.ended || this.failure !== undefined;
  }

  /** 핸드셰이크 중 먼저 읽힌 바이트를 되돌린다. */
  unshift(chunk: Buffer): void {
    if (chunk.length === 0) return;
    this.queue.unshift(chunk);
    this.queuedBytes += chunk.length;
  }

  read(timeoutMs: number = this.readTimeoutMs): Promise<Buffer | null> {
    const next = this.queue.shift();
    if (next) {
      this.queuedBytes -= next.length;
      if (this.queuedBytes < HIGH_WATER && this.socket.isPaused()) this.socket.resume();
      return Promise.resolve(next);
    }
    if (this.failure) return Promise.reject(this.failure);
    if (this.ended || this.closed) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const reader: (typeof this.readers)[number] = { resolve, reject };
      if (timeoutMs > 0) {
        reader.timer = setTimeout(() => {
          const i = this.readers.indexOf(reader);
          if (i >= 0) this.readers.splice(i, 1);
          reject(new AdbTimeoutException(`스트림 읽기 시간 초과(${this.destination}, ${timeoutMs}ms)`));
        }, timeoutMs);
      }
      this.readers.push(reader);
    });
  }

  async readAll(timeoutMs?: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for (;;) {
      const chunk = await this.read(timeoutMs);
      if (chunk === null) return Buffer.concat(chunks);
      chunks.push(chunk);
    }
  }

  write(data: Uint8Array, timeoutMs: number = this.writeTimeoutMs): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed || this.socket.destroyed) {
      return Promise.reject(new AdbConnectionClosedException(`닫힌 스트림에 쓸 수 없습니다(${this.destination}).`));
    }
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              const error = new AdbTimeoutException(`adb server 쓰기 시간 초과(${timeoutMs}ms)`);
              this.fail(error);
              this.socket.destroy();
              reject(error);
            }, timeoutMs)
          : undefined;
      this.socket.write(data, (err) => {
        if (timer) clearTimeout(timer);
        if (err) reject(new AdbConnectionClosedException('adb server에 쓰는 중 연결이 끊겼습니다.', err));
        else resolve();
      });
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy();
    this.settleReaders(null);
  }

  private push(chunk: Buffer): void {
    const reader = this.readers.shift();
    if (reader) {
      if (reader.timer) clearTimeout(reader.timer);
      reader.resolve(chunk);
      return;
    }
    this.queue.push(chunk);
    this.queuedBytes += chunk.length;
    if (this.queuedBytes >= HIGH_WATER) this.socket.pause();
  }

  private fail(error: Error): void {
    if (this.failure || this.closed) return;
    this.failure = error;
    for (const reader of this.readers.splice(0)) {
      if (reader.timer) clearTimeout(reader.timer);
      reader.reject(error);
    }
  }

  private settleReaders(value: Buffer | null): void {
    for (const reader of this.readers.splice(0)) {
      if (reader.timer) clearTimeout(reader.timer);
      reader.resolve(value);
    }
  }
}

/** adb server에 연결한 스트림을 연다(아직 요청은 보내지 않음). */
async function connectServer(options: Required<AdbServerOptions>, destination: string): Promise<AdbServerStream> {
  const socket = await new Promise<net.Socket>((resolve, reject) => {
    const s = net.connect({ host: options.host, port: options.port });
    const timer = setTimeout(() => {
      s.destroy();
      reject(new AdbConnectException(`adb server(${options.host}:${options.port}) 연결 시간 초과`));
    }, options.connectTimeoutMs);
    s.once('connect', () => {
      clearTimeout(timer);
      s.setNoDelay(true);
      resolve(s);
    });
    s.once('error', (e) => {
      clearTimeout(timer);
      reject(new AdbConnectException(`adb server(${options.host}:${options.port})에 연결하지 못했습니다.`, e));
    });
  });
  return new AdbServerStream(socket, destination, options.readTimeoutMs, options.writeTimeoutMs);
}

function encodeRequest(request: string): Buffer {
  const body = Buffer.from(request, 'utf-8');
  return Buffer.concat([Buffer.from(body.length.toString(16).padStart(4, '0'), 'ascii'), body]);
}

async function readHexString(reader: StreamReader): Promise<string> {
  const length = parseInt((await reader.readExact(4)).toString('ascii'), 16);
  if (Number.isNaN(length)) throw new AdbProtocolException('adb server 응답 길이를 해석할 수 없습니다.');
  return (await reader.readExact(length)).toString('utf-8');
}

/** 요청을 보내고 OKAY를 기다린다. FAIL이면 메시지를 담아 onFail이 만든 예외를 던진다. */
async function request(
  stream: AdbServerStream,
  reader: StreamReader,
  command: string,
  onFail: (message: string) => Error
): Promise<void> {
  await stream.write(encodeRequest(command));
  const status = (await reader.readExact(4)).toString('ascii');
  if (status === 'OKAY') return;
  if (status === 'FAIL') throw onFail(await readHexString(reader));
  throw new AdbProtocolException(`예상치 못한 adb server 응답: ${JSON.stringify(status)}`);
}

/** 호스트 서비스(host:version, host:devices 등) 하나를 실행하고 문자열 응답을 돌려준다. */
export async function adbServerQuery(command: string, options: AdbServerOptions = {}): Promise<string> {
  const stream = await connectServer(resolved(options), command);
  try {
    const reader = new StreamReader(stream, 5_000);
    await request(stream, reader, command, (m) => new AdbConnectException(`adb server 요청 실패(${command}): ${m}`));
    return await readHexString(reader);
  } finally {
    await stream.close();
  }
}

export async function isAdbServerRunning(options: AdbServerOptions = {}): Promise<boolean> {
  try {
    await adbServerQuery('host:version', options);
    return true;
  } catch {
    return false;
  }
}

export interface AdbServerDevice {
  serial: string;
  /** device | unauthorized | offline | ... */
  state: string;
}

export async function listAdbServerDevices(options: AdbServerOptions = {}): Promise<AdbServerDevice[]> {
  const output = await adbServerQuery('host:devices', options);
  return output
    .split('\n')
    .map((line) => line.trim().split('\t'))
    .filter((parts) => parts.length === 2 && parts[0] !== '')
    .map(([serial, state]) => ({ serial, state }));
}

/** adb server를 경유하는 한 기기의 세션. */
export class AdbServerSession implements AdbSession {
  readonly kind = 'server' as const;
  private closed = false;

  private constructor(
    readonly serial: string,
    private readonly options: Required<AdbServerOptions>,
    private readonly features: Set<string>
  ) {}

  /** 기기가 서버에 붙어 있는지 확인하고 기능 목록을 받아 세션을 만든다. */
  static async connect(serial: string, options: AdbServerOptions = {}): Promise<AdbServerSession> {
    const opts = resolved(options);
    const probe = new AdbServerSession(serial, opts, new Set());
    const stream = await probe.open('host:features');
    let features: string;
    try {
      features = await readHexString(new StreamReader(stream, 5_000));
    } finally {
      await stream.close();
    }
    return new AdbServerSession(serial, opts, new Set(features.split(',').filter(Boolean)));
  }

  get isClosed(): boolean {
    return this.closed;
  }

  supportsFeature(feature: string): boolean {
    return this.features.has(feature);
  }

  async open(destination: string): Promise<AdbStreamLike> {
    if (this.closed) throw new AdbConnectionClosedException('adb server 세션이 닫혔습니다.');
    const stream = await connectServer(this.options, destination);
    const reader = new StreamReader(stream, this.options.connectTimeoutMs + 5_000);
    try {
      await request(stream, reader, `host:transport:${this.serial}`, (m) =>
        /unauthori[sz]ed/i.test(m)
          ? new AdbAuthException(`기기가 인증되지 않았습니다(adb server): ${m}`)
          : new AdbConnectException(`adb server에서 기기를 사용할 수 없습니다(serial=${this.serial}): ${m}`)
      );
      await request(stream, reader, destination, (m) => new AdbStreamOpenException(destination, `서비스 열기 거부: ${m}`));
    } catch (e) {
      await stream.close();
      throw e;
    }
    stream.unshift(reader.takeBuffered());
    return stream;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
