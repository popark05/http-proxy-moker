/**
 * ADB 메시지(apacket) 인코딩/디코딩. dadb AdbMessage/AdbReader/AdbWriter 이식(Apache-2.0, NOTICE 참고).
 *
 * 헤더(리틀엔디언 uint32 x 6): command, arg0, arg1, payloadLength, checksum, magic(= command ^ 0xffffffff).
 * dadb는 블로킹 소스에서 헤더/본문을 순서대로 읽지만, Node에선 바이트가 임의 크기 청크로 도착하므로
 * MessageDecoder가 청크를 누적해 완성된 메시지만 꺼낸다.
 */

import {
  AUTH_TYPE_RSA_PUBLIC,
  CMD_AUTH,
  CMD_CLSE,
  CMD_CNXN,
  CMD_OKAY,
  CMD_OPEN,
  CMD_STLS,
  CMD_WRTE,
  CONNECT_MAXDATA,
  HEADER_LENGTH
} from './constants';
import { AdbProtocolException } from '../errors';

export interface AdbMessage {
  command: number;
  arg0: number;
  arg1: number;
  payload: Buffer;
}

/** payload 바이트의 단순 합(uint32). 구버전 adbd가 검증한다. */
export function payloadChecksum(payload: Uint8Array): number {
  let sum = 0;
  for (const byte of payload) sum = (sum + byte) >>> 0;
  return sum;
}

/**
 * 메시지 헤더를 인코딩한다. 본문은 별도로 전송한다(USB는 헤더/본문을 별도 bulk 전송으로 보내야 함).
 * payload가 없으면 길이/체크섬은 0.
 */
export function encodeHeader(command: number, arg0: number, arg1: number, payload?: Uint8Array): Buffer {
  const header = Buffer.alloc(HEADER_LENGTH);
  header.writeUInt32LE(command >>> 0, 0);
  header.writeUInt32LE(arg0 >>> 0, 4);
  header.writeUInt32LE(arg1 >>> 0, 8);
  header.writeUInt32LE(payload ? payload.length : 0, 12);
  header.writeUInt32LE(payload ? payloadChecksum(payload) : 0, 16);
  header.writeUInt32LE((command ^ 0xffffffff) >>> 0, 20);
  return header;
}

/** 헤더+본문을 한 버퍼로(테스트/TCP 편의용). */
export function encodeMessage(message: AdbMessage): Buffer {
  const header = encodeHeader(message.command, message.arg0, message.arg1, message.payload);
  return message.payload.length > 0 ? Buffer.concat([header, message.payload]) : header;
}

/**
 * 청크 스트림에서 완성된 ADB 메시지를 꺼내는 디코더.
 *
 * 체크섬은 검증하지 않는다(신버전 adbd는 0을 보냄). 대신 magic과 payload 길이 상한을 검증해
 * 동기가 깨진 스트림을 조기에 AdbProtocolException으로 드러낸다.
 */
export class MessageDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  constructor(private readonly maxPayload: number = CONNECT_MAXDATA) {}

  /** 청크를 추가하고 완성된 메시지들을 반환한다. 잘못된 헤더면 throw. */
  push(chunk: Uint8Array): AdbMessage[] {
    this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk]);
    const messages: AdbMessage[] = [];

    while (this.buffer.length >= HEADER_LENGTH) {
      const command = this.buffer.readUInt32LE(0);
      const payloadLength = this.buffer.readUInt32LE(12);
      const magic = this.buffer.readUInt32LE(20);

      if (magic !== (command ^ 0xffffffff) >>> 0) {
        throw new AdbProtocolException(
          `잘못된 ADB 헤더 magic: command=${hex(command)} magic=${hex(magic)}`
        );
      }
      if (payloadLength > this.maxPayload) {
        throw new AdbProtocolException(
          `ADB payload 길이 초과: ${payloadLength} > ${this.maxPayload} (${commandName(command)})`
        );
      }
      if (this.buffer.length < HEADER_LENGTH + payloadLength) break;

      messages.push({
        command,
        arg0: this.buffer.readUInt32LE(4),
        arg1: this.buffer.readUInt32LE(8),
        // 내부 버퍼와 메모리를 공유하지 않도록 복사.
        payload: Buffer.from(this.buffer.subarray(HEADER_LENGTH, HEADER_LENGTH + payloadLength))
      });
      this.buffer = this.buffer.subarray(HEADER_LENGTH + payloadLength);
    }

    return messages;
  }

  /** 아직 메시지로 완성되지 않은 바이트 수. */
  get pendingBytes(): number {
    return this.buffer.length;
  }
}

export function commandName(command: number): string {
  switch (command) {
    case CMD_AUTH:
      return 'AUTH';
    case CMD_CNXN:
      return 'CNXN';
    case CMD_OPEN:
      return 'OPEN';
    case CMD_OKAY:
      return 'OKAY';
    case CMD_CLSE:
      return 'CLSE';
    case CMD_WRTE:
      return 'WRTE';
    case CMD_STLS:
      return 'STLS';
    default:
      return '????';
  }
}

/** 로그용 한 줄 표현. 예: `OPEN[1, 0] shell,v2,raw:id` */
export function describeMessage(message: AdbMessage): string {
  const head = `${commandName(message.command)}[${hex(message.arg0)}, ${hex(message.arg1)}]`;
  const { payload } = message;
  if (payload.length === 0) return head;
  switch (message.command) {
    case CMD_OPEN:
      return `${head} ${payload.subarray(0, payload.length - 1).toString('utf-8')}`;
    case CMD_AUTH:
      return message.arg0 === AUTH_TYPE_RSA_PUBLIC
        ? `${head} ${payload.toString('utf-8').replace(/\0$/, '')}`
        : `${head} auth[${payload.length}]`;
    default:
      return `${head} payload[${payload.length}]`;
  }
}

function hex(value: number): string {
  return (value >>> 0).toString(16).toUpperCase();
}
