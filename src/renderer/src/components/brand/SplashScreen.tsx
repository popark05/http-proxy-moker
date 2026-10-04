import { useEffect, useState } from 'react';
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

/** 요청 입자 하나(GET/POST/MOCK). 좌표는 로고 중심(0,0) 기준. */
function Packet({
  label,
  from,
  to,
  delay,
  width,
  out
}: {
  label: string;
  from: [number, number];
  to: [number, number];
  delay: number;
  width: number;
  out?: boolean;
}): JSX.Element {
  return (
    <g
      className={cn('sp-pk', out && 'sp-out')}
      style={
        {
          '--x0': `${from[0]}px`,
          '--y0': `${from[1]}px`,
          '--x1': `${to[0]}px`,
          '--y1': `${to[1]}px`,
          animationDelay: `${delay}s`
        } as React.CSSProperties
      }
    >
      <rect x={-width / 2} y={-10} width={width} height={20} rx={4} />
      <text>{label}</text>
    </g>
  );
}

/**
 * 앱 시작 브랜드 애니메이션: 두 요청이 중앙 인터셉트 노드로 수렴하고 목 응답이 오른쪽으로 나간 뒤
 * 워드마크가 나타난다(로고 Logo.tsx의 E2 수렴 노드 구조). 클릭/키 입력으로 건너뛸 수 있다.
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
      <svg
        viewBox="0 0 680 300"
        role="img"
        aria-label="EverMock 로고 애니메이션"
        className="w-[min(680px,92vw)]"
      >
        <g transform="translate(340,120)">
          <line className="sp-ln" pathLength={1} x1={-110} y1={-76} x2={-34} y2={-14} style={{ animationDelay: '0.1s' }} />
          <line className="sp-ln" pathLength={1} x1={-110} y1={76} x2={-34} y2={14} style={{ animationDelay: '0.2s' }} />
          <line className="sp-ln" pathLength={1} x1={48} y1={0} x2={112} y2={0} style={{ animationDelay: '0.4s' }} />
          <line className="sp-flow" x1={-110} y1={-76} x2={-34} y2={-14} />
          <line className="sp-flow" x1={-110} y1={76} x2={-34} y2={14} />
          <line className="sp-flow sp-r" x1={48} y1={0} x2={112} y2={0} />
          <circle className="sp-ep" cx={-128} cy={-88} r={26} fill="hsl(var(--foreground))" style={{ animationDelay: '0.05s' }} />
          <circle className="sp-ep" cx={-128} cy={88} r={26} fill="hsl(var(--foreground))" style={{ animationDelay: '0.15s' }} />
          <g className="sp-ring-g">
            <circle className="sp-ring" pathLength={1} cx={0} cy={0} r={48} />
          </g>
          <circle className="sp-core" cx={0} cy={0} r={22} />
          <circle className="sp-ep" cx={136} cy={0} r={26} fill="hsl(var(--primary))" style={{ animationDelay: '0.5s' }} />
          <circle className="sp-wave" cx={136} cy={0} r={26} />
          <Packet label="GET" from={[-128, -88]} to={[0, 0]} delay={0.95} width={44} />
          <Packet label="POST" from={[-128, 88]} to={[0, 0]} delay={1.05} width={48} />
          <Packet label="MOCK" from={[0, 0]} to={[136, 0]} delay={1.6} width={52} out />
        </g>
        <text className="sp-word" x={340} y={262}>
          Ever<tspan className="sp-accent">Mock</tspan>
        </text>
        <text className="sp-tag" x={340} y={286}>
          CAPTURE · CLONE · MOCK
        </text>
      </svg>
    </div>
  );
}
