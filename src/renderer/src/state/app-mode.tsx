import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

/** 앱의 동작 모드. 캡처(실트래픽 관찰) vs 목킹(로컬 목 응답 재생). */
export type AppMode = 'capture' | 'mock';

interface AppModeContextValue {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
}

const AppModeContext = createContext<AppModeContextValue | undefined>(undefined);

export function AppModeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [mode, setMode] = useState<AppMode>('capture');
  const value = useMemo(() => ({ mode, setMode }), [mode]);
  return <AppModeContext.Provider value={value}>{children}</AppModeContext.Provider>;
}

export function useAppMode(): AppModeContextValue {
  const ctx = useContext(AppModeContext);
  if (!ctx) throw new Error('useAppMode must be used within AppModeProvider');
  return ctx;
}
