/**
 * 디자인 토큰 — 색상 팔레트, 타이포, 스페이싱, 라디우스, 그림자, z-index.
 * HTTPToolkit(reference/httptoolkit-ui/src/styles.ts) 패턴을 참고했으나 자체 정의(AGPL 미복사).
 */

// --- 원시 색상 팔레트 (테마가 참조) ---
export const palette = {
  black: '#000000',
  inkBlack: '#16181e',
  inkGrey: '#1e2028',
  darkerGrey: '#25262e',
  darkGrey: '#32343b',
  darkishGrey: '#53565e',
  mediumGrey: '#818490',
  lightGrey: '#9a9da8',
  ghostGrey: '#e4e8ed',
  greyWhite: '#f2f2f2',
  almostWhite: '#fafafa',
  white: '#ffffff',

  blue: '#3454d1',
  lightBlue: '#6284fa',
  darkBlue: '#2d4cbd',

  green: '#3ba55d',
  amber: '#f1971f',
  red: '#e1421f',
  purple: '#8b5cf6'
} as const;

export const fontSizes = {
  smallPrint: '12px',
  input: '13px',
  text: '14.5px',
  subHeading: '17px',
  heading: '20px',
  largeHeading: '24px'
} as const;

export const fonts = {
  sans: '"DM Sans", system-ui, Arial, sans-serif',
  mono: '"DM Mono", "SF Mono", ui-monospace, monospace'
} as const;

// 4px 그리드 기반 스페이싱.
export const space = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  xxl: '32px'
} as const;

export const radii = {
  sm: '4px',
  md: '6px',
  lg: '10px',
  pill: '999px'
} as const;

export const zIndex = {
  base: 0,
  sticky: 100,
  overlay: 500,
  modal: 1000,
  toast: 1500
} as const;

/**
 * 색 대비 최소 기준. WCAG AA(4.5:1) + float 반올림 여유.
 * 상태 색을 배경 위에 얹을 때 이 값을 검증에 사용한다.
 */
export const MIN_CONTRAST_RATIO = 4.6;
