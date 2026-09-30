/**
 * adb reverse(기기 포트 → 호스트 포트). dadb에는 없는 확장.
 *
 * 1) `reverse:forward:<remote>;<local>` 스트림으로 adbd에 기기 쪽 리스너를 설치한다.
 *    응답(AOSP adb.cpp handle_forward_request, 기기 쪽): "OKAY"[+ 길이접두 포트(remote가 tcp:0일 때)]
 *    또는 "FAIL" + 4자리 hex 길이 + 메시지. adb server를 거치면 OKAY가 하나 더 붙으므로 관대하게 파싱한다.
 * 2) 기기 앱이 그 포트에 접속하면 adbd가 호스트로 OPEN("<local>")을 보낸다.
 *    호스트는 로컬 대상(127.0.0.1:<port>)에 먼저 연결한 뒤 수락(OKAY)하고 양방향으로 중계한다.
 *
 * reverse 규칙은 이를 만든 ADB 연결(adbd 전송 세션)에 묶여 있어, 연결이 끊기면 기기에서도 사라진다.
 */

import * as net from 'node:net';
import type { AdbStreamLike } from '../protocol/session';
import type { IncomingOpen } from '../protocol/connection';
import { StreamReader } from '../protocol/stream-io';
import { AdbProtocolException } from '../errors';
import { AdbOperationFailedException } from '../results';
import type { AdbOpener } from './opener';
import { pipeSocketAndStream } from './forward';

export interface ReverseRule {
  /** 기기 쪽 사양(예: "tcp:8080"). */
  remote: string;
  /** 호스트 쪽 사양(예: "tcp:8080"). */
  local: string;
}

export interface ReverseOptions {
  /** 이미 같은 remote 규칙이 있으면 덮어쓰지 않고 실패한다. */
  noRebind?: boolean;
}

/**
 * 기기에 reverse 리스너를 설치한다. remote가 tcp:0이면 기기가 고른 포트를 돌려준다.
 * adbd가 거부하면(포트 사용 중 등) AdbOperationFailedException(전송 오류가 아님).
 */
export async function reverseForward(
  adb: AdbOpener,
  remote: string,
  local: string,
  options: ReverseOptions = {}
): Promise<{ devicePort?: number }> {
  parseLocalTcpPort(local);
  const command = options.noRebind ? 'forward:norebind' : 'forward';
  const value = await forwardRequest(adb, `reverse:${command}:${remote};${local}`);
  const devicePort = value ? Number(value) : undefined;
  return devicePort !== undefined && Number.isInteger(devicePort) ? { devicePort } : {};
}

/** remote 규칙 하나를 제거한다. 없으면 AdbOperationFailedException. */
export async function killReverse(adb: AdbOpener, remote: string): Promise<void> {
  await forwardRequest(adb, `reverse:killforward:${remote}`);
}

export async function killAllReverse(adb: AdbOpener): Promise<void> {
  await forwardRequest(adb, 'reverse:killforward-all');
}

/** 기기에 설치된 reverse 규칙 목록. 각 줄: "<serial> <remote> <local>". */
export async function listReverse(adb: AdbOpener): Promise<ReverseRule[]> {
  let reply = await readReply(await adb.open('reverse:list-forward'));
  // 기기 adbd는 길이접두 문자열만 보내지만, adb server 경유 시 앞에 OKAY가 붙는다.
  if (reply.subarray(0, 4).toString('ascii') === 'OKAY') reply = reply.subarray(4);
  if (reply.subarray(0, 4).toString('ascii') === 'FAIL') {
    throw new AdbOperationFailedException(readProtocolString(reply.subarray(4)));
  }
  return readProtocolString(reply)
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2 && parts[0] !== '')
    .map((parts) => ({ remote: parts[parts.length - 2], local: parts[parts.length - 1] }));
}

/** "tcp:<port>" → port. 다른 사양(localabstract 등)은 지원하지 않는다. */
export function parseLocalTcpPort(local: string): number {
  const match = /^tcp:(\d+)$/.exec(local);
  const port = match ? Number(match[1]) : NaN;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new RangeError(`reverse의 호스트 쪽은 "tcp:<port>"만 지원합니다: ${local}`);
  }
  return port;
}

/**
 * 기기가 연 스트림을 처리하는 핸들러. 등록된 local 사양만 허용하고,
 * 로컬 포트에 연결되면 수락해 중계, 연결 실패면 거부한다(adb server와 같은 순서).
 */
export function createReverseOpenHandler(isAllowed: (destination: string) => boolean) {
  return (request: IncomingOpen): void => {
    if (!isAllowed(request.destination)) {
      request.reject();
      return;
    }
    let port: number;
    try {
      port = parseLocalTcpPort(request.destination);
    } catch {
      request.reject();
      return;
    }
    const socket = net.connect(port, '127.0.0.1');
    socket.once('error', () => request.reject());
    socket.once('connect', () => {
      let stream: AdbStreamLike;
      try {
        stream = request.accept();
      } catch {
        socket.destroy();
        return;
      }
      pipeSocketAndStream(socket, stream);
    });
  };
}

/** forward 계열 요청을 보내고 OKAY 뒤의 값(없으면 '')을 돌려준다. FAIL이면 예외. */
async function forwardRequest(adb: AdbOpener, destination: string): Promise<string> {
  let reply = await readReply(await adb.open(destination));
  let status = reply.subarray(0, 4).toString('ascii');
  // adb server 경유 형식(OKAY OKAY)도 허용.
  if (status === 'OKAY' && reply.subarray(4, 8).toString('ascii') === 'OKAY') {
    reply = reply.subarray(4);
    status = 'OKAY';
  }
  if (status === 'OKAY') return reply.length > 4 ? readProtocolString(reply.subarray(4)) : '';
  if (status === 'FAIL') throw new AdbOperationFailedException(readProtocolString(reply.subarray(4)));
  throw new AdbProtocolException(`예상치 못한 reverse 응답: ${JSON.stringify(reply.toString('latin1'))}`);
}

/** adbd는 응답을 쓰고 스트림을 닫는다. */
async function readReply(stream: AdbStreamLike): Promise<Buffer> {
  try {
    return await new StreamReader(stream).readToEnd();
  } finally {
    await stream.close();
  }
}

/** 4자리 hex 길이 + 문자열. 형식이 아니면 전체를 문자열로. */
function readProtocolString(buffer: Buffer): string {
  const length = parseInt(buffer.subarray(0, 4).toString('ascii'), 16);
  if (buffer.length < 4 || Number.isNaN(length)) return buffer.toString('utf-8');
  return buffer.subarray(4, 4 + length).toString('utf-8');
}
