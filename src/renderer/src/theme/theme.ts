import { palette, fonts, fontSizes, space, radii, zIndex } from './tokens';

/**
 * 테마 인터페이스 — 컴포넌트가 참조하는 시맨틱 토큰.
 * 원시 팔레트를 의미 있는 역할(background/color/status 등)로 매핑한다.
 */
export interface AppTheme {
  name: 'dark' | 'light';

  fonts: typeof fonts;
  fontSizes: typeof fontSizes;
  space: typeof space;
  radii: typeof radii;
  zIndex: typeof zIndex;

  // 표면(surface)
  appBackground: string;
  panelBackground: string;
  panelRaisedBackground: string;
  containerBackground: string;

  // 텍스트
  primaryText: string;
  secondaryText: string;
  mutedText: string;

  // 경계/구분선
  border: string;
  borderSubtle: string;

  // 인터랙션(primary 버튼 등)
  accent: string;
  accentHover: string;
  accentText: string;

  // 상태 색 (배지/알림)
  statusInfo: string;
  statusSuccess: string;
  statusWarning: string;
  statusError: string;

  // 모드 표시 (상단 바 강조)
  captureModeColor: string;
  mockModeColor: string;

  // 그림자
  shadow: string;
}

const common = { fonts, fontSizes, space, radii, zIndex };

export const darkTheme: AppTheme = {
  name: 'dark',
  ...common,

  appBackground: palette.inkBlack,
  panelBackground: palette.inkGrey,
  panelRaisedBackground: palette.darkerGrey,
  containerBackground: palette.darkGrey,

  primaryText: palette.almostWhite,
  secondaryText: palette.lightGrey,
  mutedText: palette.mediumGrey,

  border: palette.darkishGrey,
  borderSubtle: palette.darkGrey,

  accent: palette.blue,
  accentHover: palette.lightBlue,
  accentText: palette.white,

  statusInfo: palette.lightBlue,
  statusSuccess: palette.green,
  statusWarning: palette.amber,
  statusError: palette.red,

  captureModeColor: palette.green,
  mockModeColor: palette.amber,

  shadow: 'rgba(0, 0, 0, 0.45)'
};

export const lightTheme: AppTheme = {
  name: 'light',
  ...common,

  appBackground: palette.almostWhite,
  panelBackground: palette.white,
  panelRaisedBackground: palette.greyWhite,
  containerBackground: palette.ghostGrey,

  primaryText: palette.inkGrey,
  secondaryText: palette.darkishGrey,
  mutedText: palette.mediumGrey,

  border: palette.lightGrey,
  borderSubtle: palette.ghostGrey,

  accent: palette.darkBlue,
  accentHover: palette.blue,
  accentText: palette.white,

  statusInfo: palette.darkBlue,
  statusSuccess: '#2c7a44',
  statusWarning: '#a5680f',
  statusError: '#b5341a',

  captureModeColor: '#2c7a44',
  mockModeColor: '#a5680f',

  shadow: 'rgba(0, 0, 0, 0.15)'
};

export const themes = { dark: darkTheme, light: lightTheme } as const;
export type ThemeName = keyof typeof themes;
