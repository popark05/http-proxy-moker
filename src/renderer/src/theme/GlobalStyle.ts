import { createGlobalStyle } from 'styled-components';
import reset from 'styled-reset';

/**
 * 전역 스타일 — CSS reset + 폰트/기본 배경/스크롤바.
 * 폰트는 @fontsource로 셀프 호스팅(오프라인 데스크탑).
 */
export const GlobalStyle = createGlobalStyle`
  ${reset}

  * {
    box-sizing: border-box;
  }

  html, body, #root {
    height: 100%;
    margin: 0;
  }

  body {
    font-family: ${({ theme }) => theme.fonts.sans};
    font-size: ${({ theme }) => theme.fontSizes.text};
    background-color: ${({ theme }) => theme.appBackground};
    color: ${({ theme }) => theme.primaryText};
    -webkit-font-smoothing: antialiased;
    line-height: 1.4;
  }

  code, pre {
    font-family: ${({ theme }) => theme.fonts.mono};
  }

  :focus-visible {
    outline: 2px solid ${({ theme }) => theme.accentHover};
    outline-offset: 1px;
  }

  ::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
  ::-webkit-scrollbar-thumb {
    background: ${({ theme }) => theme.border};
    border-radius: ${({ theme }) => theme.radii.pill};
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
`;
