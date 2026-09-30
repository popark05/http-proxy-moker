// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { AdbPacketReader, AdbPacketWriter } from '../../../src/main/adb/protocol/packet-io';
import { encodeMessage } from '../../../src/main/adb/protocol/message';
import { CMD_OKAY, CMD_WRTE, HEADER_LENGTH } from '../../../src/main/adb/protocol/constants';
import {
  AdbConnectionClosedException,
  AdbProtocolException,
  AdbTimeoutException
} from '../../../src/main/adb/errors';
import { MemoryTransport, msg } from './fake-adbd';

function timeoutError(): Error {
  return Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
}

describe('AdbPacketWriter', () => {
  // dadb AdbWriterTest 이식.
  it('쓰기 타임아웃은 AdbTimeoutException(원인 보존)', async () => {
    const transport = new MemoryTransport();
    const cause = timeoutError();
    transport.failNextWrite = cause;
    const writer = new AdbPacketWriter(transport);

    const thrown = await writer.writeWrite(1, 2, Buffer.alloc(8)).catch((e) => e);
    expect(thrown).toBeInstanceOf(AdbTimeoutException);
    expect(thrown.cause).toBe(cause);
  });

  it('타임아웃 외 쓰기 실패는 AdbConnectionClosedException', async () => {
    const transport = new MemoryTransport();
    transport.failNextWrite = new Error('broken pipe');
    const writer = new AdbPacketWriter(transport);

    await expect(writer.writeOkay(1, 2)).rejects.toBeInstanceOf(AdbConnectionClosedException);
  });

  it('헤더와 본문을 별도 write로 보냄(USB bulk 전송 단위)', async () => {
    const transport = new MemoryTransport();
    await new AdbPacketWriter(transport).writeWrite(1, 2, Buffer.from('abc'));
    expect(transport.writes.map((w) => w.length)).toEqual([HEADER_LENGTH, 3]);
  });

  it('동시 쓰기가 섞이지 않음(헤더-본문 순서 유지)', async () => {
    const transport = new MemoryTransport();
    const writer = new AdbPacketWriter(transport);
    await Promise.all([
      writer.writeWrite(1, 2, Buffer.from('first')),
      writer.writeWrite(3, 4, Buffer.from('second'))
    ]);
    expect(Buffer.concat(transport.writes)).toEqual(
      Buffer.concat([
        encodeMessage(msg(CMD_WRTE, 1, 2, 'first')),
        encodeMessage(msg(CMD_WRTE, 3, 4, 'second'))
      ])
    );
  });

  it('실패한 쓰기 뒤에도 다음 쓰기는 진행', async () => {
    const transport = new MemoryTransport();
    const writer = new AdbPacketWriter(transport);
    transport.failNextWrite = new Error('x');
    const first = writer.writeOkay(1, 2);
    const second = writer.writeOkay(3, 4);
    await expect(first).rejects.toBeInstanceOf(AdbConnectionClosedException);
    await expect(second).resolves.toBeUndefined();
  });
});

describe('AdbPacketReader', () => {
  it('도착 순서대로 메시지를 돌려줌(대기 전/후 모두)', async () => {
    const transport = new MemoryTransport();
    const reader = new AdbPacketReader(transport);
    transport.deliver(encodeMessage(msg(CMD_OKAY, 1, 1)));
    const pending = reader.read();
    expect((await pending).arg0).toBe(1);

    const next = reader.read();
    transport.deliver(encodeMessage(msg(CMD_OKAY, 2, 2)));
    expect((await next).arg0).toBe(2);
  });

  it('읽기 타임아웃은 AdbTimeoutException이고 이후 메시지는 계속 받음', async () => {
    const transport = new MemoryTransport();
    const reader = new AdbPacketReader(transport);
    await expect(reader.read(10)).rejects.toBeInstanceOf(AdbTimeoutException);

    transport.deliver(encodeMessage(msg(CMD_OKAY, 9, 9)));
    expect((await reader.read(10)).arg0).toBe(9);
  });

  it('연결 종료 시 대기 중/이후 read 모두 AdbConnectionClosedException', async () => {
    const transport = new MemoryTransport();
    const reader = new AdbPacketReader(transport);
    const pending = reader.read();
    const cause = new Error('reset');
    transport.remoteClose(cause);

    const thrown = await pending.catch((e) => e);
    expect(thrown).toBeInstanceOf(AdbConnectionClosedException);
    expect(thrown.cause).toBe(cause);
    await expect(reader.read()).rejects.toBeInstanceOf(AdbConnectionClosedException);
  });

  it('잘못된 패킷은 AdbProtocolException', async () => {
    const transport = new MemoryTransport();
    const reader = new AdbPacketReader(transport);
    const pending = reader.read();
    transport.deliver(Buffer.alloc(24, 0x01));
    await expect(pending).rejects.toBeInstanceOf(AdbProtocolException);
  });
});
