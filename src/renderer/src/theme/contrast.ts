/**
 * WCAG 색 대비 계산 유틸.
 * 상태 색/텍스트 색이 배경 위에서 AA(4.5:1) 기준을 만족하는지 검증하는 데 사용한다.
 * 참고: https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */

function parseHex(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '').trim();
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized;
  if (full.length !== 6 || /[^0-9a-fA-F]/.test(full)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16)
  };
}

function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** "H S% L%" (공백 구분, CSS 변수 형식) → RGB. */
export function parseHsl(hsl: string): { r: number; g: number; b: number } {
  const m = hsl.trim().match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!m) throw new Error(`Invalid hsl triplet: ${hsl}`);
  const h = parseFloat(m[1]) / 360;
  const s = parseFloat(m[2]) / 100;
  const l = parseFloat(m[3]) / 100;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
  };
}

function toRgb(color: string): { r: number; g: number; b: number } {
  return color.includes('%') ? parseHsl(color) : parseHex(color);
}

export function relativeLuminance(color: string): number {
  const { r, g, b } = toRgb(color);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** 두 색의 대비비(1:1 ~ 21:1)를 반환. */
export function contrastRatio(foreground: string, background: string): number {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA(일반 텍스트 4.5:1) 충족 여부. */
export function meetsAA(foreground: string, background: string): boolean {
  return contrastRatio(foreground, background) >= 4.5;
}
