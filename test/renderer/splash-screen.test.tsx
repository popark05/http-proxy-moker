import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SplashScreen } from '../../src/renderer/src/components/brand/SplashScreen';

// hairline은 DOM 드로잉 라이브러리라 jsdom에서는 빈 상자로 대체한다.
vi.mock('@lucasmarkes/hairline/react', () => ({ Slow: () => <div data-testid="figure-slow" /> }));

function mockReducedMotion(reduce: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
}

describe('SplashScreen', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockReducedMotion(false);
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('처음 실행에서는 로고 애니메이션을 보여주고 시간이 지나면 사라진다', () => {
    render(<SplashScreen />);
    expect(screen.getByTestId('splash')).toBeTruthy();
    expect(screen.getByLabelText('EverMock 로고 애니메이션')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(3200)); // 표시 시간 끝 → 페이드 시작
    expect(screen.getByTestId('splash')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(350)); // 페이드 끝 → 제거
    expect(screen.queryByTestId('splash')).toBeNull();
  });

  it('클릭하면 바로 건너뛴다', () => {
    render(<SplashScreen />);
    fireEvent.click(screen.getByTestId('splash'));
    act(() => void vi.advanceTimersByTime(350));
    expect(screen.queryByTestId('splash')).toBeNull();
  });

  it('아무 키나 눌러도 건너뛴다', () => {
    render(<SplashScreen />);
    fireEvent.keyDown(window, { key: 'Escape' });
    act(() => void vi.advanceTimersByTime(350));
    expect(screen.queryByTestId('splash')).toBeNull();
  });

  it('같은 세션에서 다시 마운트(새로고침)하면 보이지 않는다', () => {
    const first = render(<SplashScreen />);
    first.unmount();
    render(<SplashScreen />);
    expect(screen.queryByTestId('splash')).toBeNull();
  });

  it('모션 줄이기 설정이면 애니메이션 없이 바로 앱을 보여준다', () => {
    mockReducedMotion(true);
    render(<SplashScreen />);
    expect(screen.queryByTestId('splash')).toBeNull();
  });
});
