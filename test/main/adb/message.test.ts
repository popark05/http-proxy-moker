// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  MessageDecoder,
  describeMessage,
  encodeHeader,
  encodeMessage,
  payloadChecksum
} from '../../../src/main/adb/protocol/message';
import {
  AUTH_TYPE_RSA_PUBLIC,
  AUTH_TYPE_TOKEN,
  CMD_AUTH,
  CMD_CNXN,
  CMD_OKAY,
  CMD_OPEN,
  CMD_WRTE,
  HEADER_LENGTH
} from '../../../src/main/adb/protocol/constants';
import { AdbProtocolException } from '../../../src/main/adb/errors';
import { msg } from './fake-adbd';

describe('encodeHeader', () => {
  it('명령 값은 4글자 ASCII의 리틀엔디언 표현', () => {
    const header = encodeHeader(CMD_CNXN, 0, 0);
    expect(header.subarray(0, 4).toString('ascii')).toBe('CNXN');
  });

  it('헤더 필드: args, 길이, 체크섬, magic', () => {
    const payload = Buffer.from([1, 2, 0xff]);
    const header = encodeHeader(CMD_WRTE, 7, 0xfffffffe, payload);
    expect(header.length).toBe(HEADER_LENGTH);
    expect(header.readUInt32LE(4)).toBe(7);
    expect(header.readUInt32LE(8)).toBe(0xfffffffe);
    expect(header.readUInt32LE(12)).toBe(3);
    expect(header.readUInt32LE(16)).toBe(258);
    expect(header.readUInt32LE(20)).toBe((CMD_WRTE ^ 0xffffffff) >>> 0);
  });

  it('payload 없으면 길이/체크섬 0', () => {
    const header = encodeHeader(CMD_OKAY, 1, 2);
    expect(header.readUInt32LE(12)).toBe(0);
    expect(header.readUInt32LE(16)).toBe(0);
  });

  it('체크섬은 부호 없는 바이트 합', () => {
    expect(payloadChecksum(Buffer.from([0xff, 0xff]))).toBe(510);
  });
});

describe('MessageDecoder', () => {
  const sample = [
    msg(CMD_OPEN, 1, 0, 'shell:id\0'),
    msg(CMD_OKAY, 5, 1),
    msg(CMD_WRTE, 5, 1, Buffer.alloc(1000, 0x61))
  ];
  const bytes = Buffer.concat(sample.map(encodeMessage));

  it('한 청크의 여러 메시지를 모두 디코딩', () => {
    const decoded = new MessageDecoder().push(bytes);
    expect(decoded).toEqual(sample);
  });

  it('1바이트씩 쪼개 도착해도 동일하게 디코딩', () => {
    const decoder = new MessageDecoder();
    const decoded = [...bytes].flatMap((b) => decoder.push(Uint8Array.of(b)));
    expect(decoded).toEqual(sample);
    expect(decoder.pendingBytes).toBe(0);
  });

  it('본문이 덜 왔으면 대기', () => {
    const decoder = new MessageDecoder();
    const one = encodeMessage(sample[2]);
    expect(decoder.push(one.subarray(0, 100))).toEqual([]);
    expect(decoder.pendingBytes).toBe(100);
    expect(decoder.push(one.subarray(100))).toEqual([sample[2]]);
  });

  it('magic 불일치는 AdbProtocolException', () => {
    const broken = encodeMessage(sample[1]);
    broken.writeUInt32LE(0, 20);
    expect(() => new MessageDecoder().push(broken)).toThrow(AdbProtocolException);
  });

  it('payload 길이가 상한을 넘으면 AdbProtocolException', () => {
    const header = encodeHeader(CMD_WRTE, 1, 1, Buffer.alloc(64));
    expect(() => new MessageDecoder(32).push(header)).toThrow(AdbProtocolException);
  });

  it('체크섬은 검증하지 않음(신버전 adbd는 0을 보냄)', () => {
    const noChecksum = encodeMessage(sample[0]);
    noChecksum.writeUInt32LE(0, 16);
    expect(new MessageDecoder().push(noChecksum)).toEqual([sample[0]]);
  });
});

describe('describeMessage', () => {
  it('OPEN은 목적지를 NUL 없이 표시', () => {
    expect(describeMessage(msg(CMD_OPEN, 1, 0, 'shell:id\0'))).toBe('OPEN[1, 0] shell:id');
  });

  it('AUTH 공개키는 문자열, 토큰은 길이만', () => {
    expect(describeMessage(msg(CMD_AUTH, AUTH_TYPE_RSA_PUBLIC, 0, 'KEY a@b\0'))).toBe(
      'AUTH[3, 0] KEY a@b'
    );
    expect(describeMessage(msg(CMD_AUTH, AUTH_TYPE_TOKEN, 0, Buffer.alloc(20)))).toBe(
      'AUTH[1, 0] auth[20]'
    );
  });
});
