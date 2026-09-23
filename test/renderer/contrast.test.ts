import { describe, it, expect } from 'vitest';
import { contrastRatio, meetsAA } from '../../src/renderer/src/theme/contrast';

/**
 * 실제 UI에서 쓰는 shadcn CSS 변수(globals.css의 .dark) 값으로 대비를 검증한다.
 * 값이 바뀌면 여기도 함께 갱신해 접근성 회귀를 잡는다.
 */
const dark = {
  background: '220 26% 8%',
  card: '219 24% 11%',
  foreground: '214 24% 92%',
  mutedForeground: '216 14% 60%',
  primary: '218 90% 66%',
  success: '158 42% 46%',
  warning: '38 70% 56%',
  destructive: '6 66% 58%'
};

describe('contrastRatio', () => {
  it('검정/흰색 최대 대비는 21에 가깝다', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('동일 색 대비는 1이다', () => {
    expect(contrastRatio('#3454d1', '#3454d1')).toBeCloseTo(1, 5);
  });

  it('3자리 hex도 처리한다', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 0);
  });

  it('HSL 트리플릿(CSS 변수 형식)도 처리한다', () => {
    // 0 0% 0% (검정) vs 0 0% 100% (흰색)
    expect(contrastRatio('0 0% 0%', '0 0% 100%')).toBeCloseTo(21, 0);
  });
});

describe('다크 테마 CSS 토큰 대비는 WCAG AA를 만족한다', () => {
  const onBg: Array<[string, string]> = [
    ['foreground', dark.foreground],
    ['muted-foreground', dark.mutedForeground],
    ['primary', dark.primary],
    ['success', dark.success],
    ['warning', dark.warning],
    ['destructive', dark.destructive]
  ];

  for (const [name, color] of onBg) {
    it(`${name} / background`, () => {
      expect(meetsAA(color, dark.background)).toBe(true);
    });
  }

  it('foreground / card', () => {
    expect(meetsAA(dark.foreground, dark.card)).toBe(true);
  });

  it('muted-foreground / card', () => {
    expect(meetsAA(dark.mutedForeground, dark.card)).toBe(true);
  });
});
