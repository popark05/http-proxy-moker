import { cn } from '@/lib/utils';

/** EverMock 로고 마크 (E2 수렴 노드). currentColor 기반이라 어디서든 색 상속. */
export function LogoMark({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 200 200"
      className={cn('size-6', className)}
      fill="none"
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeLinecap="round">
        {/* 좌상 → 중앙 */}
        <circle cx="42" cy="60" r="12" fill="currentColor" stroke="none" />
        <line x1="52" y1="68" x2="86" y2="96" strokeWidth="14" />
        {/* 좌하 → 중앙 */}
        <circle cx="42" cy="140" r="12" fill="currentColor" stroke="none" />
        <line x1="52" y1="132" x2="86" y2="104" strokeWidth="14" />
        {/* 중앙 인터셉트 노드 */}
        <circle cx="100" cy="100" r="22" strokeWidth="15" />
        {/* 중앙 → 우 */}
        <line x1="122" y1="100" x2="150" y2="100" strokeWidth="14" />
      </g>
      {/* 우측 엔드포인트(액센트) */}
      <circle cx="162" cy="100" r="12" className="fill-primary" />
    </svg>
  );
}

/** 로고 마크 + 워드마크(EverMock). */
export function LogoWordmark({ className }: { className?: string }): JSX.Element {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <LogoMark className="size-6 text-foreground" />
      <span className="text-[17px] font-bold tracking-tight">
        Ever<span className="text-primary">Mock</span>
      </span>
    </div>
  );
}
