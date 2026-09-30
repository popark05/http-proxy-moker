/**
 * 서비스 계층이 기대하는 스트림/세션 표면.
 *
 * - 직접 연결(AdbConnection): ADB 패킷(OPEN/WRTE/OKAY/CLSE)으로 다중화한 AdbStream.
 * - adb server 경유(AdbServerSession): 스트림마다 adb server(5037)로 소켓을 열어
 *   `host:transport:<serial>` → `<service>` 후 소켓 바이트를 그대로 쓴다.
 * 셸/sync/설치/reverse 서비스는 어느 쪽이든 같은 바이트를 주고받으므로 이 인터페이스만 안다.
 */

export interface AdbStreamLike {
  readonly destination: string;
  /** 쓰기를 모을 단위(직접 연결은 기기의 maxPayload). */
  readonly maxPayloadSize: number;
  readonly isClosed: boolean;
  /** 다음 청크. 상대가 닫았고 남은 데이터가 없으면 null(EOF). 타임아웃은 그 호출만 실패시킨다. */
  read(timeoutMs?: number): Promise<Buffer | null>;
  /** EOF까지 전부. */
  readAll(timeoutMs?: number): Promise<Buffer>;
  write(data: Uint8Array, timeoutMs?: number): Promise<void>;
  /** 닫기(멱등). */
  close(): Promise<void>;
}

export interface AdbSession {
  /** direct: 우리가 ADB 프로토콜을 직접 말함(USB/TCP). server: 실행 중인 adb server를 경유. */
  readonly kind: 'direct' | 'server';
  readonly isClosed: boolean;
  open(destination: string, timeoutMs?: number): Promise<AdbStreamLike>;
  supportsFeature(feature: string): boolean;
  close(): Promise<void>;
}
