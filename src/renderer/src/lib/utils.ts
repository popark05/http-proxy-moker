import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn 표준 className 병합 유틸(clsx + tailwind-merge). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** 같은 히트가 연속으로 와도 애니메이션이 처음부터 다시 재생되도록 클래스를 재부착한다. */
export function restartAnimation(el: HTMLElement | null, className: string): void {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth; // 리플로우 강제 → 애니메이션 재시작.
  el.classList.add(className);
}
