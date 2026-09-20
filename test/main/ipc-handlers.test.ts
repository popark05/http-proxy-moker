import { describe, it, expect } from 'vitest';
import { handlePing } from '../../src/main/ipc-handlers';

describe('handlePing', () => {
  it('메시지를 pong 접두사로 감싸 반환한다', () => {
    const result = handlePing({ message: 'hello' }, () => 1_000);
    expect(result.message).toBe('pong: hello');
    expect(result.repliedAt).toBe(1_000);
  });

  it('repliedAt에 현재 시각 함수 결과를 사용한다', () => {
    const result = handlePing({ message: 'x' }, () => 42);
    expect(result.repliedAt).toBe(42);
  });
});
