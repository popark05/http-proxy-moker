/**
 * sync 서비스(push/pull). dadb AdbSync 이식(Apache-2.0, NOTICE 참고).
 *
 * `sync:` 스트림의 패킷: [id:4바이트 ASCII][arg:uint32 LE][data]
 *   SEND "<path>,<mode>" → DATA(최대 64KB)* → DONE(mtime 초) → 기기: OKAY | FAIL(msg)
 *   RECV "<path>" → 기기: DATA* → DONE | FAIL(msg)
 *   QUIT → 종료
 */

import { createReadStream, promises as fs } from 'node:fs';
import type { AdbStream } from '../protocol/stream';
import { StreamReader, StreamWriter } from '../protocol/stream-io';
import { AdbProtocolException } from '../errors';
import { SUCCESS, failure, type SyncResult } from '../results';
import type { AdbOpener } from './opener';

/** adbd sync 프로토콜의 DATA 최대 크기(SYNC_DATA_MAX). */
export const SYNC_DATA_MAX = 64 * 1024;
/** 기본 권한(rw-r--r--). adbd는 심볼릭 링크가 아니면 mode & 0777만 쓴다. */
export const DEFAULT_PUSH_MODE = 0o644;

/** 보낼 바이트: Buffer 또는 청크 스트림(Readable 등). */
export type ByteSource = Uint8Array | AsyncIterable<Uint8Array>;
/** 받은 청크를 처리하는 함수(역압이 필요하면 Promise를 반환). */
export type ByteSink = (chunk: Buffer) => void | Promise<void>;

/**
 * adbd가 sync FAIL로 응답(파일 없음, 권한 없음 등). 전송은 멀쩡하므로 AdbException이 아니며,
 * Dadb.push/pull이 잡아 SyncResult 실패로 바꾼다.
 */
export class AdbSyncFailError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'AdbSyncFailError';
  }
}

export class AdbSyncStream {
  private readonly reader: StreamReader;
  private readonly writer: StreamWriter;

  constructor(private readonly stream: AdbStream) {
    this.reader = new StreamReader(stream);
    this.writer = new StreamWriter(stream);
  }

  async send(source: ByteSource, remotePath: string, mode: number, lastModifiedMs: number): Promise<void> {
    const remote = Buffer.from(`${remotePath},${mode}`, 'utf-8');
    await this.writePacket('SEND', remote.length, remote);

    for await (const chunk of chunks(source)) {
      await this.writePacket('DATA', chunk.length, chunk);
    }
    await this.writePacket('DONE', Math.floor(lastModifiedMs / 1000));
    await this.writer.flush();

    const packet = await this.readPacket();
    if (packet.id === 'FAIL') throw new AdbSyncFailError(await this.readString(packet.arg));
    if (packet.id !== 'OKAY') throw new AdbProtocolException(`예상치 못한 sync 패킷: ${packet.id}`);
  }

  async recv(sink: ByteSink, remotePath: string): Promise<void> {
    const path = Buffer.from(remotePath, 'utf-8');
    await this.writePacket('RECV', path.length, path);
    await this.writer.flush();

    for (;;) {
      const packet = await this.readPacket();
      if (packet.id === 'DONE') return;
      if (packet.id === 'FAIL') throw new AdbSyncFailError(await this.readString(packet.arg));
      if (packet.id !== 'DATA') throw new AdbProtocolException(`예상치 못한 sync 패킷: ${packet.id}`);
      await sink(await this.reader.readExact(packet.arg));
    }
  }

  /** QUIT을 보내고 스트림을 닫는다. */
  async close(): Promise<void> {
    try {
      await this.writePacket('QUIT', 0);
      await this.writer.flush();
    } catch {
      // 이미 끊긴 스트림이면 QUIT은 의미가 없다.
    }
    await this.stream.close();
  }

  private async writePacket(id: string, arg: number, data?: Uint8Array): Promise<void> {
    const header = Buffer.alloc(8);
    header.write(id, 0, 4, 'ascii');
    header.writeUInt32LE(arg >>> 0, 4);
    await this.writer.write(header);
    if (data) await this.writer.write(data);
  }

  private async readPacket(): Promise<{ id: string; arg: number }> {
    const header = await this.reader.readExact(8);
    return { id: header.toString('ascii', 0, 4), arg: header.readUInt32LE(4) };
  }

  private async readString(length: number): Promise<string> {
    return (await this.reader.readExact(length)).toString('utf-8');
  }
}

export async function openSync(adb: AdbOpener): Promise<AdbSyncStream> {
  return new AdbSyncStream(await adb.open('sync:'));
}

/**
 * 로컬 파일/바이트를 기기로 보낸다. 파일 경로를 주면 파일의 권한/수정 시각을 쓴다(dadb와 동일).
 * adbd의 FAIL은 SyncResult 실패로, 전송 오류는 AdbException으로 던진다.
 */
export async function push(
  adb: AdbOpener,
  src: string | ByteSource,
  remotePath: string,
  mode?: number,
  lastModifiedMs?: number
): Promise<SyncResult> {
  let source: ByteSource;
  if (typeof src === 'string') {
    const stat = await fs.stat(src);
    source = createReadStream(src, { highWaterMark: SYNC_DATA_MAX });
    mode ??= stat.mode;
    lastModifiedMs ??= stat.mtimeMs;
  } else {
    source = src;
  }

  const sync = await openSync(adb);
  try {
    await sync.send(source, remotePath, mode ?? DEFAULT_PUSH_MODE, lastModifiedMs ?? Date.now());
    return SUCCESS;
  } catch (e) {
    if (e instanceof AdbSyncFailError) return failure(e.reason);
    throw e;
  } finally {
    await sync.close();
  }
}

/**
 * 기기 파일을 받는다. dst가 경로면 파일로 쓰고, 실패하면 만들다 만 파일을 지운다.
 * 함수를 주면 청크마다 호출한다.
 */
export async function pull(adb: AdbOpener, dst: string | ByteSink, remotePath: string): Promise<SyncResult> {
  if (typeof dst === 'function') return pullTo(adb, dst, remotePath);

  const file = await fs.open(dst, 'w');
  let result: SyncResult | undefined;
  try {
    result = await pullTo(adb, async (chunk) => {
      await file.write(chunk);
    }, remotePath);
    return result;
  } finally {
    await file.close();
    if (!result?.success) await fs.rm(dst, { force: true });
  }
}

async function pullTo(adb: AdbOpener, sink: ByteSink, remotePath: string): Promise<SyncResult> {
  const sync = await openSync(adb);
  try {
    await sync.recv(sink, remotePath);
    return SUCCESS;
  } catch (e) {
    if (e instanceof AdbSyncFailError) return failure(e.reason);
    throw e;
  } finally {
    await sync.close();
  }
}

/** 임의 크기 청크를 SYNC_DATA_MAX 이하로 나눈다. */
async function* chunks(source: ByteSource): AsyncGenerator<Uint8Array> {
  const iterable: AsyncIterable<Uint8Array> | Iterable<Uint8Array> =
    source instanceof Uint8Array ? [source] : source;
  for await (const chunk of iterable) {
    for (let offset = 0; offset < chunk.length; offset += SYNC_DATA_MAX) {
      yield chunk.subarray(offset, Math.min(offset + SYNC_DATA_MAX, chunk.length));
    }
  }
}
