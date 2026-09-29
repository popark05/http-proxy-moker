/**
 * shell v2 서비스. dadb AdbShell 이식(Apache-2.0, NOTICE 참고).
 *
 * `shell,v2,raw:<cmd>` 스트림은 패킷 단위로 오간다: [id:1][length:uint32 LE][payload].
 *   id 0 stdin(호스트→기기), 1 stdout, 2 stderr, 3 exit(기기→호스트, payload 1바이트) / close-stdin(호스트→기기)
 * v1 `shell:`과 달리 stdout/stderr가 분리되고 종료 코드를 받을 수 있다.
 */

import type { AdbStream } from '../protocol/stream';
import { StreamReader } from '../protocol/stream-io';
import { AdbProtocolException } from '../errors';
import { AdbUnsupportedFeatureException } from '../results';
import type { AdbOpener } from './opener';

export const ID_STDIN = 0;
export const ID_STDOUT = 1;
export const ID_STDERR = 2;
export const ID_EXIT = 3;
export const ID_CLOSE_STDIN = 3;

export type AdbShellPacket =
  | { type: 'stdout'; payload: Buffer }
  | { type: 'stderr'; payload: Buffer }
  | { type: 'exit'; exitCode: number };

export interface AdbShellResponse {
  output: string;
  errorOutput: string;
  exitCode: number;
  /** output + errorOutput */
  allOutput: string;
}

export class AdbShellStream {
  private readonly reader: StreamReader;

  constructor(private readonly stream: AdbStream) {
    this.reader = new StreamReader(stream);
  }

  /** 다음 패킷. 잘못된 id/길이는 동기가 깨진 것이므로 AdbProtocolException. */
  async read(): Promise<AdbShellPacket> {
    const id = await this.reader.readUInt8();
    if (id !== ID_STDOUT && id !== ID_STDERR && id !== ID_EXIT) {
      throw new AdbProtocolException(`잘못된 shell 패킷 id: ${id}`);
    }
    const length = await this.reader.readUInt32LE();
    if (id === ID_EXIT && length !== 1) {
      throw new AdbProtocolException(`shell exit 패킷 길이가 1이 아닙니다: ${length}`);
    }
    const payload = await this.reader.readExact(length);
    if (id === ID_EXIT) return { type: 'exit', exitCode: payload.readUInt8(0) };
    return { type: id === ID_STDOUT ? 'stdout' : 'stderr', payload };
  }

  /**
   * exit 패킷까지 모두 읽는다.
   * 출력은 바이트로 모았다가 마지막에 디코딩한다(dadb는 패킷마다 디코딩해 멀티바이트 문자가 잘릴 수 있음).
   */
  async readAll(): Promise<AdbShellResponse> {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    for (;;) {
      const packet = await this.read();
      if (packet.type === 'stdout') out.push(packet.payload);
      else if (packet.type === 'stderr') err.push(packet.payload);
      else {
        const output = Buffer.concat(out).toString('utf-8');
        const errorOutput = Buffer.concat(err).toString('utf-8');
        return { output, errorOutput, exitCode: packet.exitCode, allOutput: output + errorOutput };
      }
    }
  }

  /** stdin으로 보낸다. */
  write(input: string | Uint8Array): Promise<void> {
    return this.writePacket(ID_STDIN, typeof input === 'string' ? Buffer.from(input, 'utf-8') : input);
  }

  /** stdin을 닫는다(EOF). */
  closeStdin(): Promise<void> {
    return this.writePacket(ID_CLOSE_STDIN);
  }

  close(): Promise<void> {
    return this.stream.close();
  }

  private writePacket(id: number, payload?: Uint8Array): Promise<void> {
    const header = Buffer.alloc(5);
    header.writeUInt8(id, 0);
    header.writeUInt32LE(payload?.length ?? 0, 1);
    return this.stream.write(payload ? Buffer.concat([header, payload]) : header);
  }
}

/** 셸 스트림을 연다. 명령을 비우면 대화형 sh(stdin으로 명령 전달). */
export async function openShell(adb: AdbOpener, command = ''): Promise<AdbShellStream> {
  if (!(await adb.supportsFeature('shell_v2'))) {
    // shell_v2는 Android 7(API 24)부터. dadb도 v2만 지원한다.
    throw new AdbUnsupportedFeatureException('shell_v2', '이 기기는 shell v2를 지원하지 않습니다(Android 7 미만).');
  }
  return new AdbShellStream(await adb.open(`shell,v2,raw:${command}`));
}

/** 명령을 실행하고 출력/종료 코드를 돌려준다. 0이 아닌 종료 코드는 예외가 아니라 값이다. */
export async function shell(adb: AdbOpener, command: string): Promise<AdbShellResponse> {
  const stream = await openShell(adb, command);
  try {
    return await stream.readAll();
  } finally {
    await stream.close();
  }
}
