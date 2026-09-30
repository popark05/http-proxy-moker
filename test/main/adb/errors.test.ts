// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  AdbAuthException,
  AdbConnectException,
  AdbConnectionClosedException,
  AdbException,
  AdbProtocolException,
  AdbStreamOpenException,
  AdbTimeoutException
} from '../../../src/main/adb/errors';

// dadb AdbExceptionTest 이식. (거부된 TCP 연결 케이스는 TCP 전송을 구현하는 A-2에서 이식)

describe('AdbException', () => {
  it('모든 타입이 AdbException이자 Error', () => {
    const exceptions: AdbException[] = [
      new AdbConnectException('x'),
      new AdbAuthException('x'),
      new AdbStreamOpenException('shell:', 'x'),
      new AdbConnectionClosedException('x'),
      new AdbTimeoutException('x'),
      new AdbProtocolException('x')
    ];
    for (const e of exceptions) {
      expect(e).toBeInstanceOf(AdbException);
      expect(e).toBeInstanceOf(Error);
    }
  });

  it('name은 구체 클래스명', () => {
    expect(new AdbAuthException('x').name).toBe('AdbAuthException');
  });

  it('AdbStreamOpenException은 destination을 보존', () => {
    const e = new AdbStreamOpenException('exec:cmd package install', 'refused');
    expect(e.destination).toBe('exec:cmd package install');
  });

  it('cause를 보존', () => {
    const cause = new Error('socket reset');
    expect(new AdbConnectException('x', cause).cause).toBe(cause);
  });
});
