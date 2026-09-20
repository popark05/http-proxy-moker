import { describe, it, expect } from 'vitest';
import { contrastRatio, meetsAA } from '../../src/renderer/src/theme/contrast';
import { darkTheme, lightTheme } from '../../src/renderer/src/theme/theme';

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
});

describe('테마 텍스트 대비는 WCAG AA를 만족한다', () => {
  for (const theme of [darkTheme, lightTheme]) {
    it(`${theme.name}: primaryText / appBackground`, () => {
      expect(meetsAA(theme.primaryText, theme.appBackground)).toBe(true);
    });

    it(`${theme.name}: primaryText / panelBackground`, () => {
      expect(meetsAA(theme.primaryText, theme.panelBackground)).toBe(true);
    });

    it(`${theme.name}: secondaryText / panelBackground`, () => {
      expect(meetsAA(theme.secondaryText, theme.panelBackground)).toBe(true);
    });
  }
});
