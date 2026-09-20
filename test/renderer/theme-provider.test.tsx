import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppThemeProvider, useAppTheme } from '../../src/renderer/src/theme/ThemeProvider';

function ThemeProbe(): JSX.Element {
  const { themeName, toggleTheme } = useAppTheme();
  return (
    <div>
      <span data-testid="theme-name">{themeName}</span>
      <button onClick={toggleTheme}>toggle</button>
    </div>
  );
}

describe('AppThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    // matchMedia 목킹 (jsdom 미구현)
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    );
  });

  it('기본 테마는 dark다', () => {
    render(
      <AppThemeProvider>
        <ThemeProbe />
      </AppThemeProvider>
    );
    expect(screen.getByTestId('theme-name')).toHaveTextContent('dark');
  });

  it('토글하면 light로 바뀌고 localStorage에 저장된다', () => {
    render(
      <AppThemeProvider>
        <ThemeProbe />
      </AppThemeProvider>
    );
    fireEvent.click(screen.getByText('toggle'));
    expect(screen.getByTestId('theme-name')).toHaveTextContent('light');
    expect(localStorage.getItem('moker.theme')).toBe('light');
  });
});
