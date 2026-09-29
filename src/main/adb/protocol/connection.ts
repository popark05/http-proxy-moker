/**
 * ADB 연결 수립(CNXN/AUTH 핸드셰이크). dadb AdbConnection.connect 이식(Apache-2.0, NOTICE 참고).
 *
 * 흐름: CNXN 전송 → (AUTH TOKEN 수신 시) 서명 전송 → (다시 AUTH면) 공개키 전송 → CNXN 수신.
 * 공개키를 보낸 뒤에는 사용자가 기기에서 "USB 디버깅 허용"을 누를 때까지 응답이 오지 않으므로
 * 별도 타임아웃(authTimeoutMs)을 두고 AdbAuthException으로 알린다(dadb는 소켓 타임아웃에 의존).
 *
 * 스트림 다중화(open)는 다음 단계(A-2)에서 이 클래스 위에 추가한다.
 */

import type { AdbTransport } from '../transport/transport';
import {
  AdbAuthException,
  AdbConnectException,
  AdbProtocolException,
  AdbTimeoutException
} from '../errors';
import {
  AUTH_TYPE_RSA_PUBLIC,
  AUTH_TYPE_SIGNATURE,
  AUTH_TYPE_TOKEN,
  CMD_AUTH,
  CMD_CNXN,
  CMD_STLS
} from './constants';
import { describeMessage, type AdbMessage } from './message';
import { AdbPacketReader, AdbPacketWriter } from './packet-io';
import type { AdbKeyPair } from './key-pair';

export interface ConnectOptions {
  /** 인증 키. 없고 기기가 인증을 요구하면 AdbAuthException. */
  keyPair?: AdbKeyPair;
  /** CNXN/AUTH 응답 대기 시간(ms). 기본 10초. */
  handshakeTimeoutMs?: number;
  /** 공개키 전송 후 사용자의 허용을 기다리는 시간(ms). 기본 60초. */
  authTimeoutMs?: number;
}

const DEFAULT_HANDSHAKE_TIMEOUT = 10_000;
const DEFAULT_AUTH_TIMEOUT = 60_000;

/** CNXN 배너("device::ro.product.name=...;features=...")에서 얻은 기기 정보. */
export interface AdbBanner {
  /** 연결 상태: device | recovery | sideload | bootloader ... */
  state: string;
  /** ro.product.name / ro.product.model / ro.product.device 등. */
  properties: Record<string, string>;
  features: Set<string>;
}

export class AdbConnection {
  private closed = false;

  private constructor(
    readonly transport: AdbTransport,
    readonly reader: AdbPacketReader,
    readonly writer: AdbPacketWriter,
    readonly banner: AdbBanner,
    /** adbd 프로토콜 버전(CNXN arg0). */
    readonly version: number,
    /** adbd가 받을 수 있는 최대 payload(CNXN arg1). WRTE 분할 크기로 쓴다. */
    readonly maxPayloadSize: number
  ) {}

  supportsFeature(feature: string): boolean {
    return this.banner.features.has(feature);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.transport.close().catch(() => undefined);
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
      return new AdbConnection(transport, reader, writer, banner, message.arg0, message.arg1);
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
