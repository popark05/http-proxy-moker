import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Tailwind v4 + shadcn 디자인 토큰 + Astryx 레이어 순서. 가장 먼저 불러와야 레이어 순서가 맞는다.
import './styles/globals.css';

import { Theme } from '@astryxdesign/core/theme';
import { evermockTheme } from './theme/astryx-theme';

// 셀프 호스팅 폰트(오프라인 데스크탑). @fontsource가 CSS + woff2를 번들에 포함.
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';

import { App } from './App';

// 다크 테마 기본 적용(shadcn 변수는 .dark에서 활성).
document.documentElement.classList.add('dark');

const container = document.getElementById('root');
if (!container) throw new Error('#root element not found');

createRoot(container).render(
  <StrictMode>
    <Theme theme={evermockTheme} mode="dark">
      <App />
    </Theme>
  </StrictMode>
);
