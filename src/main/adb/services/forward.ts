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

/**
 * 소켓과 ADB 스트림을 양방향으로 잇는다. 한쪽이 끝나면 다른 쪽도 닫는다
 * (ADB 스트림은 half-close가 없으므로 소켓이 end하면 스트림을 닫는다).
 * 역압: 스트림 쓰기(OKAY 대기) 동안 소켓 읽기를 멈추고, 소켓 버퍼가 차면 drain까지 스트림 읽기를 멈춘다.
 */
export function pipeSocketAndStream(socket: net.Socket, stream: AdbStreamLike): void {
  let done = false;
  const shutdown = (): void => {
    if (done) return;
    done = true;
    socket.destroy();
    void stream.close();
  };

  socket.on('data', (chunk: Buffer) => {
    socket.pause();
    stream.write(chunk, 0).then(() => socket.resume(), shutdown);
  });
  socket.on('end', shutdown);
  socket.on('error', shutdown);
  socket.on('close', shutdown);
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
    // 기기 쪽이 끝났으면 버퍼에 남은 데이터를 보내고 소켓을 닫는다.
    done = true;
    void stream.close();
    socket.end();
  })();
}
