/**
 * TCP 포트 포워딩(호스트 포트 → 기기 포트). dadb TcpForwarder 이식(Apache-2.0, NOTICE 참고).
 *
 * 호스트에서 포트를 열고, 들어오는 연결마다 기기의 `tcp:<port>` 스트림을 열어 양방향으로 중계한다.
 * dadb는 모든 인터페이스에 바인딩하지만 여기서는 127.0.0.1에만 바인딩한다(외부 노출 방지).
 */

import * as net from 'node:net';
import { once } from 'node:events';
import type { AdbStreamLike } from '../protocol/session';
import type { AdbOpener } from './opener';

export interface AdbTunnel {
  /** 실제 바인딩된 호스트 포트(hostPort에 0을 주면 임의 포트). */
  readonly port: number;
  close(): Promise<void>;
}

export async function tcpForward(adb: AdbOpener, hostPort: number, targetPort: number): Promise<AdbTunnel> {
  const clients = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => {});
    // 소켓을 멈춰 두고 스트림이 열린 뒤 읽기 시작(그 사이 데이터 유실 방지).
    socket.pause();
    adb.open(`tcp:${targetPort}`).then(
      (stream) => pipeSocketAndStream(socket, stream),
      () => socket.destroy()
    );
  });

  server.listen(hostPort, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as net.AddressInfo).port;

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of clients) socket.destroy();
        server.close(() => resolve());
      })
  };
}

/** 기기 ack를 기다리며 쌓아 둘 수 있는 소켓 데이터의 상한. 넘으면 소켓 읽기를 잠시 멈춘다. */
const QUEUE_HIGH_WATER = 1024 * 1024;
/** 상대(프록시)가 끝난 뒤 기기 ack를 기다려 주는 최대 시간. 이 안에 못 보내면 그냥 닫는다. */
const FLUSH_TIMEOUT_MS = 1000;

/**
 * 소켓과 ADB 스트림을 양방향으로 잇는다. 한쪽이 끝나면 다른 쪽도 닫는다
 * (ADB 스트림은 half-close가 없으므로 소켓이 end하면 스트림을 닫는다).
 *
 * 소켓 → 스트림은 "즉시 읽고 순서대로 쓰는 큐"다. 예전처럼 chunk마다 소켓을 멈추고 ack를 기다리면,
 * 그 사이 도착한 마지막 TLS 레코드(예: chunked 종료 `0\r\n\r\n`)가 커널 버퍼에 남은 채 상대가 FIN/RST로
 * 닫혀 기기에 전달되지 못한다(웹뷰가 잘린 본문을 받아 백화). 받은 데이터는 항상 기기로 모두 쓴 뒤에 CLSE한다.
 * 기기가 ack하지 않으면 FLUSH_TIMEOUT_MS 뒤에 닫고, 스트림 쓰기가 실패하면 바로 닫는다.
 * 기기 → 소켓은 읽기 루프가 drain까지 멈추는 방식으로 역압을 건다.
 */
export function pipeSocketAndStream(socket: net.Socket, stream: AdbStreamLike): void {
  let done = false;
  const shutdown = (): void => {
    if (done) return;
    done = true;
    clearTimeout(flushTimer);
    socket.destroy();
    void stream.close();
  };

  const queue: Buffer[] = [];
  let queued = 0;
  let pumping = false;
  let peerEnded = false;
  let flushTimer: NodeJS.Timeout | undefined;

  const pump = async (): Promise<void> => {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length > 0 && !done) {
        const chunk = queue.shift()!;
        queued -= chunk.length;
        await stream.write(chunk, 0);
        if (queued < QUEUE_HIGH_WATER && !peerEnded && !done) socket.resume();
      }
    } catch {
      pumping = false;
      shutdown();
      return;
    }
    pumping = false;
    if (peerEnded) shutdown();
  };

  const onPeerEnd = (): void => {
    if (peerEnded) return;
    peerEnded = true;
    if (pumping || queue.length > 0) flushTimer = setTimeout(shutdown, FLUSH_TIMEOUT_MS);
    void pump();
  };

  socket.on('data', (chunk: Buffer) => {
    queue.push(chunk);
    queued += chunk.length;
    if (queued >= QUEUE_HIGH_WATER) socket.pause();
    void pump();
  });
  socket.on('end', onPeerEnd);
  socket.on('error', onPeerEnd);
  socket.on('close', onPeerEnd);
  socket.resume();

  void (async () => {
    try {
      for (;;) {
        const chunk = await stream.read(0);
        if (chunk === null || done) break;
        if (!socket.write(chunk)) await once(socket, 'drain');
      }
    } catch {
      // 연결 오류: 아래에서 정리.
    }
    if (done) return;
    clearTimeout(flushTimer);
    // 기기 쪽이 끝났으면 버퍼에 남은 데이터를 보내고 소켓을 닫는다.
    done = true;
    void stream.close();
    socket.end();
  })();
}
