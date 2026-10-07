import { useEffect, useState } from 'react';
import { Slow } from '@lucasmarkes/hairline/react';
import { cn } from '@/lib/utils';
import './splash.css';

/** 같은 창(세션)에서 새로고침해도 다시 보이지 않게 하는 표시. */
const SHOWN_KEY = 'evermock.splash.shown';
/** 애니메이션 길이(마지막 요소가 나타난 뒤 잠시 머문다). */
const SHOW_MS = 3200;
const FADE_MS = 300;

type Phase = 'show' | 'leaving' | 'gone';

/** 읽기 전용 판정(StrictMode가 초기화 함수를 두 번 불러도 결과가 같도록 부작용 없음). */
function shouldShow(): boolean {
  // 모션 줄이기 설정이면 애니메이션 없이 바로 앱을 보여준다.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  try {
    return !sessionStorage.getItem(SHOWN_KEY);
  } catch {
    return true;
  }
}

/**
 * 앱 시작 브랜드 애니메이션: hairline `Slow`(크레이트가 게이트를 지나는 컨베이어)가 "요청이 프록시를
 * 통과한다"를 보여주고, 이어서 워드마크가 나타난다. 클릭/키 입력으로 건너뛸 수 있다.
 */
export function SplashScreen(): JSX.Element | null {
  const [phase, setPhase] = useState<Phase>(() => (shouldShow() ? 'show' : 'gone'));

  useEffect(() => {
    if (phase !== 'show') return;
    try {
      sessionStorage.setItem(SHOWN_KEY, '1');
    } catch {
      // 저장 불가(차단된 환경)여도 이번 실행에서는 정상 동작한다.
    }
    const leave = (): void => setPhase('leaving');
    const timer = setTimeout(leave, SHOW_MS);
    window.addEventListener('keydown', leave);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', leave);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== 'leaving') return;
    const timer = setTimeout(() => setPhase('gone'), FADE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  if (phase === 'gone') return null;

  return (
    <div
      data-testid="splash"
      onClick={() => setPhase('leaving')}
      className={cn(
        'fixed inset-0 z-[100] flex cursor-pointer items-center justify-center bg-background transition-opacity',
        phase === 'leaving' ? 'pointer-events-none opacity-0' : 'opacity-100'
      )}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      {/* 창 상단은 드래그 영역으로 남겨 두어 애니메이션 중에도 창을 옮길 수 있다. */}
      <div
        className="absolute inset-x-0 top-0 h-10"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
      <div role="img" aria-label="EverMock 로고 애니메이션" className="hairline-theme flex w-[min(460px,84vw)] flex-col items-center">
        <div className="sp-fig w-full">
          <Slow label="요청이 프록시 게이트를 통과하는 컨베이어" intensity={0.3} />
        </div>
        <div className="sp-word-html">
          Ever<span className="sp-accent">Mock</span>
        </div>
        <div className="sp-tag-html">CAPTURE · CLONE · MOCK</div>
      </div>
    </div>
  );
}
