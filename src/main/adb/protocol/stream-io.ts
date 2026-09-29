/**
 * AdbStream 위의 바이트 단위 읽기/쓰기(dadb가 okio BufferedSource/BufferedSink로 하던 일).
 *
 * - StreamReader: WRTE payload 경계와 무관하게 정확히 n바이트, uint32, 줄 단위로 읽는다.
 * - StreamWriter: 작은 쓰기를 모아 maxPayload 크기 WRTE로 보낸다. WRTE마다 OKAY 왕복이 있으므로
 *   sync 패킷 헤더(8바이트)와 데이터를 따로 보내면 왕복이 두 배가 된다.
 */

import type { AdbStream } from './stream';
import { AdbProtocolException } from '../errors';

export class StreamReader {
  private buffer: Buffer = Buffer.alloc(0);
  private eof = false;

  /** timeoutMs: 청크 하나를 기다리는 시간. 생략하면 연결의 기본값. */
  constructor(
    private readonly stream: AdbStream,
    private readonly timeoutMs?: number
  ) {}

  /** 정확히 n바이트. 그 전에 스트림이 끝나면 AdbProtocolException. */
  async readExact(n: number): Promise<Buffer> {
    while (this.buffer.length < n) {
      if (!(await this.fill())) {
        throw new AdbProtocolException(
          `스트림이 예상보다 일찍 끝났습니다(${this.stream.destination}: ${n}바이트 필요, ${this.buffer.length}바이트 남음).`
        );
      }
    }
    const out = Buffer.from(this.buffer.subarray(0, n));
    this.buffer = this.buffer.subarray(n);
    return out;
  }

  async readUInt8(): Promise<number> {
    return (await this.readExact(1)).readUInt8(0);
  }

  async readUInt32LE(): Promise<number> {
    return (await this.readExact(4)).readUInt32LE(0);
  }

  /** 구분 바이트까지(포함) 읽는다. 그 전에 끝나면 남은 바이트를 돌려준다. */
  async readUntil(delimiter: number): Promise<Buffer> {
    for (;;) {
      const idx = this.buffer.indexOf(delimiter);
      if (idx >= 0) return this.readExact(idx + 1);
      if (!(await this.fill())) {
        const rest = this.buffer;
        this.buffer = Buffer.alloc(0);
        return rest;
      }
    }
  }

  /** EOF까지 전부. */
  async readToEnd(): Promise<Buffer> {
    while (await this.fill());
    const rest = this.buffer;
    this.buffer = Buffer.alloc(0);
    return rest;
  }

  private async fill(): Promise<boolean> {
    if (this.eof) return false;
    const chunk = await this.stream.read(this.timeoutMs);
    if (chunk === null) {
      this.eof = true;
      return false;
    }
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    return true;
  }
}

export class StreamWriter {
  private parts: Buffer[] = [];
  private size = 0;

  constructor(
    private readonly stream: AdbStream,
    private readonly timeoutMs?: number
  ) {}

  /** 버퍼에 쌓고, maxPayload 이상 모이면 꽉 찬 WRTE들을 보낸다. */
  async write(data: Uint8Array): Promise<void> {
    if (data.length === 0) return;
    this.parts.push(Buffer.from(data));
    this.size += data.length;
    const max = this.stream.maxPayloadSize;
    if (this.size < max) return;

    const all = Buffer.concat(this.parts);
    const full = all.length - (all.length % max);
    const rest = all.subarray(full);
    this.parts = rest.length > 0 ? [rest] : [];
    this.size = rest.length;
    await this.stream.write(all.subarray(0, full), this.timeoutMs);
  }

  /** 남은 바이트를 모두 보낸다. */
  async flush(): Promise<void> {
    if (this.size === 0) return;
    const all = Buffer.concat(this.parts);
    this.parts = [];
    this.size = 0;
    await this.stream.write(all, this.timeoutMs);
  }
}
