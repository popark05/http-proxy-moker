import { describe, it, expect } from 'vitest';
import { interceptionStarted } from '../../src/renderer/src/state/useDevices';
import type { InterceptionResult } from '../../src/shared/device';

const result = (over: Partial<InterceptionResult> = {}): InterceptionResult => ({
  deviceId: 'd',
  proxyConfigured: true,
  caInstalled: true,
  warnings: [],
  ...over
});

describe('interceptionStarted', () => {
  it('Android는 프록시 설정이 적용된 경우만 시작된 것으로 본다', () => {
    expect(interceptionStarted('android', result())).toBe(true);
    expect(interceptionStarted('android', result({ proxyConfigured: false, warnings: ['x'] }))).toBe(false);
  });

  it('iOS는 자동 설정이 없어 항상 안내 결과로 본다', () => {
    expect(interceptionStarted('ios', result({ proxyConfigured: false }))).toBe(true);
  });
});
