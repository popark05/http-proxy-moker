import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ThemeProvider as StyledThemeProvider } from 'styled-components';
import { themes, type ThemeName } from './theme';

interface ThemeContextValue {
  themeName: ThemeName;
  toggleTheme: () => void;
  setThemeName: (name: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = 'moker.theme';

/** 저장된 선호 테마를 읽되, 없으면 OS 다크모드 여부를 따르고 기본은 dark. */
function resolveInitialTheme(): ThemeName {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // localStorage 접근 불가(테스트 등) 시 무시
  }
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}

export function AppThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [themeName, setThemeNameState] = useState<ThemeName>(resolveInitialTheme);

  const setThemeName = useCallback((name: ThemeName) => {
    setThemeNameState(name);
    try {
      localStorage.setItem(STORAGE_KEY, name);
    } catch {
      // 무시
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeName(themeName === 'dark' ? 'light' : 'dark');
  }, [themeName, setThemeName]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeName;
  }, [themeName]);

  const value = useMemo<ThemeContextValue>(
    () => ({ themeName, toggleTheme, setThemeName }),
    [themeName, toggleTheme, setThemeName]
  );

  return (
    <ThemeContext.Provider value={value}>
      {/*
        과도기: Tailwind/shadcn(globals.css)로 이전 중이라 styled-components의 GlobalStyle은
        제거하고(스타일 충돌 방지), styled 컴포넌트가 아직 남은 화면을 위해 theme만 공급한다.
        모든 화면이 Tailwind로 이전되면 이 Provider 전체를 제거한다.
      */}
      <StyledThemeProvider theme={themes[themeName]}>{children}</StyledThemeProvider>
    </ThemeContext.Provider>
  );
}

export function useAppTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useAppTheme must be used within AppThemeProvider');
  return ctx;
}
