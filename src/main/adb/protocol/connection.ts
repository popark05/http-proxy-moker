/**
 * ADB 연결 수립(CNXN/AUTH 핸드셰이크). dadb AdbConnection.connect 이식(Apache-2.0, NOTICE 참고).
 *
 * 흐름: CNXN 전송 → (AUTH TOKEN 수신 시) 서명 전송 → (다시 AUTH면) 공개키 전송 → CNXN 수신.
 * 공개키를 보낸 뒤에는 사용자가 기기에서 "USB 디버깅 허용"을 누를 때까지 응답이 오지 않으므로
 * 별도 타임아웃(authTimeoutMs)을 두고 AdbAuthException으로 알린다(dadb는 소켓 타임아웃에 의존).
 *
 * 연결 후에는 디스패치 루프가 수신 메시지를 localId(arg1)로 스트림에 라우팅한다.
 * 이 루프가 실패(연결 끊김/잘못된 패킷)하면 연결은 죽고, 모든 스트림의 대기 작업이 그 오류로 깨어난다.
 * 죽은 연결은 재사용하지 않는다 — 상위(Dadb)가 다음 작업에서 새로 연결한다(dadb DadbImpl과 동일).
 */

import type { AdbTransport } from '../transport/transport';
import {
  AdbAuthException,
  AdbConnectException,
  AdbConnectionClosedException,
  AdbException,
  AdbProtocolException,
  AdbTimeoutException
} from '../errors';
import {
  AUTH_TYPE_RSA_PUBLIC,
  AUTH_TYPE_SIGNATURE,
  AUTH_TYPE_TOKEN,
  CMD_AUTH,
  CMD_CLSE,
  CMD_CNXN,
  CMD_OKAY,
  CMD_OPEN,
  CMD_STLS,
  CMD_WRTE
} from './constants';
import { describeMessage, type AdbMessage } from './message';
import { AdbPacketReader, AdbPacketWriter } from './packet-io';
import type { AdbKeyPair } from './key-pair';
import { AdbStream, type StreamHost } from './stream';

export interface ConnectOptions {
  /** 인증 키. 없고 기기가 인증을 요구하면 AdbAuthException. */
  keyPair?: AdbKeyPair;
  /** CNXN/AUTH 응답 대기 시간(ms). 기본 10초. */
  handshakeTimeoutMs?: number;
  /** 공개키 전송 후 사용자의 허용을 기다리는 시간(ms). 기본 60초. */
  authTimeoutMs?: number;
  /** 스트림 열기/읽기/쓰기 응답의 기본 대기 시간(ms). 0이면 무제한(기본, dadb socketTimeout=0과 동일). */
  readTimeoutMs?: number;
}

const DEFAULT_HANDSHAKE_TIMEOUT = 10_000;
const DEFAULT_AUTH_TIMEOUT = 60_000;

/**
 * 기기가 여는 스트림(adb reverse로 설정한 포트에 기기 앱이 접속할 때) 요청.
 * 핸들러는 반드시 accept()나 reject() 중 하나를 호출해야 한다(기기가 응답을 기다림).
 */
export interface IncomingOpen {
  /** 기기가 요청한 목적지(reverse의 local 사양, 예: "tcp:8080"). */
  readonly destination: string;
  /** 수락: 스트림을 만들고 OKAY로 응답한다. 연결이 이미 닫혔으면 AdbConnectionClosedException. */
  accept(): AdbStream;
  /** 거부: CLSE로 응답한다. */
  reject(): void;
}

/** CNXN 배너("device::ro.product.name=...;features=...")에서 얻은 기기 정보. */
export interface AdbBanner {
  /** 연결 상태: device | recovery | sideload | bootloader ... */
  state: string;
  /** ro.product.name / ro.product.model / ro.product.device 등. */
  properties: Record<string, string>;
  features: Set<string>;
}

export class AdbConnection implements StreamHost {
  private closed = false;
  /** localId → 스트림. */
  private readonly streams = new Map<number, AdbStream>();
  /**
   * localId는 순차 발급(AOSP adb 클라이언트와 동일). dadb 주석대로 무작위 ID는 사용 중인 ID와 충돌해
   * 살아 있는 스트림을 파괴할 수 있다. 0은 "원격 ID 없음"을 뜻하므로 1부터 시작한다.
   */
  private nextLocalId = 0;
  private openHandler: ((request: IncomingOpen) => void) | undefined;

  private constructor(
    readonly transport: AdbTransport,
    readonly reader: AdbPacketReader,
    readonly writer: AdbPacketWriter,
    readonly banner: AdbBanner,
    /** adbd 프로토콜 버전(CNXN arg0). */
    readonly version: number,
    /** adbd가 받을 수 있는 최대 payload(CNXN arg1). WRTE 분할 크기로 쓴다. */
    readonly maxPayloadSize: number,
    readonly readTimeoutMs: number
  ) {}

  get isClosed(): boolean {
    return this.closed;
  }

  supportsFeature(feature: string): boolean {
    return this.banner.features.has(feature);
  }

  /**
   * 서비스 스트림을 연다(예: "shell,v2,raw:id", "sync:").
   * adbd가 거부하면 AdbStreamOpenException(연결은 계속 사용 가능).
   */
  async open(destination: string, timeoutMs: number = this.readTimeoutMs): Promise<AdbStream> {
    if (this.closed) throw new AdbConnectionClosedException('ADB 연결이 이미 닫혔습니다.');
    const localId = ++this.nextLocalId;
    const stream = new AdbStream(this, localId, destination);
    this.streams.set(localId, stream);
    const opened = stream.waitOpened(timeoutMs);
    // writeOpen이 실패하면 아래에서 stream.fail()로 정리하므로 여기선 unhandled만 막는다.
    opened.catch(() => undefined);
    try {
      await this.writer.writeOpen(localId, destination);
    } catch (e) {
      stream.fail(e as AdbException);
      throw e;
    }
    await opened;
    return stream;
  }

  /**
   * 기기가 여는 스트림의 처리기를 설정한다(adb reverse). 없으면 모두 거부한다.
   * reverse 규칙은 이 연결(adbd 전송 세션)에 묶여 있어, 연결이 끊기면 기기에서도 사라진다.
   */
  setOpenHandler(handler: ((request: IncomingOpen) => void) | undefined): void {
    this.openHandler = handler;
  }

  unregister(localId: number): void {
    this.streams.delete(localId);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.failAll(new AdbConnectionClosedException('ADB 연결을 닫았습니다.'));
    await this.transport.close().catch(() => undefined);
  }

  /** 디스패치 루프: 연결이 죽을 때까지 메시지를 스트림으로 라우팅한다. */
  private async dispatchLoop(): Promise<void> {
    for (;;) {
      let message: AdbMessage;
      try {
        message = await this.reader.read();
      } catch (e) {
        this.failAll(
          e instanceof AdbException ? e : new AdbConnectionClosedException('ADB 연결이 끊겼습니다.', e)
        );
        await this.transport.close().catch(() => undefined);
        return;
      }
      if (this.closed) return;
      this.dispatch(message);
    }
  }

  private dispatch(message: AdbMessage): void {
    // 기기가 보내는 메시지: arg0 = 기기 쪽 ID, arg1 = 우리 localId.
    const stream = this.streams.get(message.arg1);
    switch (message.command) {
      case CMD_OKAY:
        stream?.onOkay(message.arg0);
        return;
      case CMD_WRTE:
        stream?.onWrite(message.payload);
        return;
      case CMD_CLSE:
        stream?.onRemoteClose();
        return;
      case CMD_OPEN:
        this.onIncomingOpen(message);
        return;
      default:
        // 연결 중 CNXN/AUTH 등은 기기 재시작 등으로 세션이 깨진 것. 재동기화할 수 없으므로 연결을 끊는다.
        this.failAll(new AdbProtocolException(`연결 중 예상치 못한 메시지: ${describeMessage(message)}`));
        void this.transport.close().catch(() => undefined);
    }
  }

  /** 기기가 연 스트림: arg0 = 기기 쪽 ID, payload = 목적지 + NUL. */
  private onIncomingOpen(message: AdbMessage): void {
    const remoteId = message.arg0;
    const destination = message.payload.toString('utf-8').replace(/\0$/, '');
    const reject = (): void => void this.writer.writeClose(0, remoteId).catch(() => undefined);

    const handler = this.openHandler;
    if (!handler) {
      reject();
      return;
    }
    let settled = false;
    const request: IncomingOpen = {
      destination,
      accept: () => {
        if (settled) throw new Error('이미 처리한 OPEN 요청입니다.');
        settled = true;
        if (this.closed) throw new AdbConnectionClosedException('ADB 연결이 이미 닫혔습니다.');
        const stream = new AdbStream(this, ++this.nextLocalId, destination);
        stream.acceptRemote(remoteId);
        this.streams.set(stream.localId, stream);
        void this.writer.writeOkay(stream.localId, remoteId).catch(() => undefined);
        return stream;
      },
      reject: () => {
        if (settled) return;
        settled = true;
        reject();
      }
    };
    try {
      handler(request);
    } catch {
      request.reject();
    }
  }

  private failAll(error: AdbException): void {
    this.closed = true;
    const streams = [...this.streams.values()];
    this.streams.clear();
    for (const stream of streams) stream.fail(error);
  }

  /**
   * 전송 계층 위에서 핸드셰이크를 수행한다. 실패하면 전송을 닫고 AdbException을 던진다.
   */
  static async connect(transport: AdbTransport, options: ConnectOptions = {}): Promise<AdbConnection> {
    const reader = new AdbPacketReader(transport);
    const writer = new AdbPacketWriter(transport);
    try {
      const message = await handshake(reader, writer, options);
      const banner = parseBanner(message.payload.toString('utf-8'));
      const connection = new AdbConnection(
        transport,
        reader,
        writer,
        banner,
        message.arg0,
        message.arg1,
        options.readTimeoutMs ?? 0
      );
      void connection.dispatchLoop();
      return connection;
    } catch (e) {
      await transport.close().catch(() => undefined);
      // 인증/프로토콜/연결 오류는 그대로, 그 외(연결 끊김·타임아웃 등)는 연결 실패로 감싼다.
      if (
        e instanceof AdbAuthException ||
        e instanceof AdbConnectException ||
        e instanceof AdbProtocolException
      ) {
        throw e;
      }
      throw new AdbConnectException('ADB 연결 핸드셰이크 실패', e);
    }
  }
}

async function handshake(
  reader: AdbPacketReader,
  writer: AdbPacketWriter,
  options: ConnectOptions
): Promise<AdbMessage> {
  const handshakeTimeout = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT;
  const authTimeout = options.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT;

  await writer.writeConnect();
  let message = await reader.read(handshakeTimeout);

  if (message.command === CMD_AUTH) {
    const { keyPair } = options;
    if (!keyPair) throw new AdbAuthException('기기가 인증을 요구하지만 키가 없습니다.');
    if (message.arg0 !== AUTH_TYPE_TOKEN) {
      throw new AdbProtocolException(`지원하지 않는 AUTH 타입: ${describeMessage(message)}`);
    }

    // 1) 이미 허용된 키라면 서명만으로 통과한다.
    await writer.writeAuth(AUTH_TYPE_SIGNATURE, keyPair.signToken(message.payload));
    message = await reader.read(handshakeTimeout);

    // 2) 서명이 거부되면(새 토큰으로 AUTH 재요청) 공개키를 보내 기기에 허용 팝업을 띄운다.
    if (message.command === CMD_AUTH) {
      await writer.writeAuth(AUTH_TYPE_RSA_PUBLIC, keyPair.publicKeyBytes);
      try {
        message = await reader.read(authTimeout);
      } catch (e) {
        if (e instanceof AdbTimeoutException) {
          throw new AdbAuthException(
            '기기에서 USB 디버깅 허용을 기다리다 시간이 초과되었습니다. 기기 화면에서 허용해 주세요.',
            e
          );
        }
        throw e;
      }
    }
  }

  if (message.command === CMD_CNXN) return message;

  // 공개키 전송 후에도 AUTH가 오면 기기가 키를 거부한 것(unauthorized).
  if (message.command === CMD_AUTH) {
    throw new AdbAuthException('기기가 인증을 거부했습니다(unauthorized).');
  }
  if (message.command === CMD_STLS) {
    throw new AdbConnectException('기기가 TLS 연결(무선 디버깅)을 요구합니다. 아직 지원하지 않습니다.');
  }
  throw new AdbConnectException(`연결 실패: 예상치 못한 응답 ${describeMessage(message)}`);
}

/**
 * CNXN 배너 파싱. 예:
 *   device::ro.product.name=sdk_gphone_x86;ro.product.model=...;features=shell_v2,cmd,...
 * features가 없으면 AdbConnectException(dadb와 동일).
 */
export function parseBanner(raw: string): AdbBanner {
  const text = raw.replace(/\0+$/, '');
  const sep = text.indexOf('::');
  const state = sep >= 0 ? text.slice(0, sep) : text;
  const rest = sep >= 0 ? text.slice(sep + 2) : '';

  const properties: Record<string, string> = {};
  for (const part of rest.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    properties[part.slice(0, eq)] = part.slice(eq + 1);
  }

  const featuresRaw = properties.features;
  if (featuresRaw === undefined) {
    throw new AdbConnectException(`연결 배너에서 features를 찾을 수 없습니다: ${text}`);
  }
  delete properties.features;
  const features = new Set(featuresRaw.split(',').filter((f) => f.length > 0));
  return { state, properties, features };
}
