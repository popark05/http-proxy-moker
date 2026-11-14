import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';

/**
 * EverMock 테마의 소스(원본). neutral을 바탕으로, 이미 번들한 DM Sans / DM Mono를 쓴다.
 * 폰트 CSS(@astryxdesign/theme-neutral/fonts.css)는 Google Fonts를 네트워크에서 불러오므로 오프라인 데스크탑 앱에서는 쓰지 않는다
 * (폰트 파일은 main.tsx의 @fontsource가 번들한다).
 *
 * 이 파일을 고치면 `npm run theme:build`로 evermock.css / evermock.js / evermock.d.ts를 다시 만들어 함께 커밋한다.
 * Astryx를 올린 뒤에도 다시 빌드해야 한다(빌드된 테마는 런타임에 CSS를 고치지 않는다).
 */
export const evermockTheme = defineTheme({
  name: 'evermock',
  extends: neutralTheme,
  // Astryx 크롬(상단 내비·섹션 내비·본문 바탕)이 나머지 UI(shadcn 변수, Catppuccin Mocha)와 같은 색을 쓰도록 우리 CSS 변수에 연결한다.
  // 변수를 참조하므로 라이트/다크 모두 globals.css의 값을 따른다. 새 색을 여기에 하드코딩하지 않는다.
  tokens: {
    '--color-background-body': 'hsl(var(--background))',
    '--color-background-surface': 'hsl(var(--background))',
    '--color-background-card': 'hsl(var(--card))',
    '--color-background-popover': 'hsl(var(--popover))',
    '--color-background-muted': 'hsl(var(--muted))',
    '--color-border': 'hsl(var(--border))',
    '--color-border-emphasized': 'hsl(var(--input))',
    '--color-text-primary': 'hsl(var(--foreground))',
    '--color-text-secondary': 'hsl(var(--muted-foreground))',
    '--color-accent': 'hsl(var(--primary))',
    '--color-on-accent': 'hsl(var(--primary-foreground))'
  },
  typography: {
    body: { family: 'DM Sans', fallbacks: 'system-ui, sans-serif' },
    heading: { family: 'DM Sans', fallbacks: 'system-ui, sans-serif' },
    code: { family: 'DM Mono', fallbacks: 'ui-monospace, monospace' }
  }
});
