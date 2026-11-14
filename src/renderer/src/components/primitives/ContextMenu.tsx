import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MenuItem {
  label: string;
  /** 모든 항목은 아이콘을 가진다(눈으로 훑을 때 동작을 구분하기 위해). */
  icon: LucideIcon;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
  /** 앞에 구분선을 긋는다(항목이 많은 메뉴를 묶어 보여 줄 때). */
  separatorBefore?: boolean;
}

const MENU_WIDTH = 200;
const ITEM_HEIGHT = 28;
const MAX_HEIGHT_RATIO = 0.7;

/** 마우스 우클릭이나, 키보드로 연 경우 요소 위치로 만든 같은 모양의 좌표. */
export interface MenuAnchor {
  clientX: number;
  clientY: number;
  preventDefault: () => void;
  stopPropagation: () => void;
}

interface OpenMenu {
  x: number;
  y: number;
  items: MenuItem[];
}

/**
 * 우클릭 메뉴. 외부 의존성 없이 구현했다(Esc, 바깥 클릭, 스크롤/리사이즈로 닫힌다).
 * `open(event, items)`를 onContextMenu에 연결하고 `element`를 한 번 렌더하면 된다.
 */
export function useContextMenu(): {
  open: (event: MenuAnchor, items: MenuItem[]) => void;
  element: JSX.Element | null;
} {
  const [menu, setMenu] = useState<OpenMenu | undefined>(undefined);
  const ref = useRef<HTMLDivElement>(null);
  /** 메뉴를 열기 전에 포커스가 있던 요소. 닫으면 거기로 돌려준다(키보드 사용자가 자리를 잃지 않게). */
  const returnFocus = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setMenu(undefined);
    returnFocus.current?.focus?.();
    returnFocus.current = null;
  }, []);

  const open = useCallback((event: MenuAnchor, items: MenuItem[]) => {
    event.preventDefault();
    event.stopPropagation();
    if (items.length === 0) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // 화면 밖으로 나가지 않게 오른쪽/아래 끝에서는 안쪽으로 당긴다.
    const x = Math.min(event.clientX, window.innerWidth - MENU_WIDTH - 8);
    // 항목이 많아 화면보다 길면(최대 높이로 줄어 스크롤된다) 줄어든 높이를 기준으로 당긴다.
    const height = Math.min(items.length * ITEM_HEIGHT, window.innerHeight * MAX_HEIGHT_RATIO);
    const y = Math.min(event.clientY, window.innerHeight - height - 16);
    setMenu({ x: Math.max(4, x), y: Math.max(4, y), items });
  }, []);

  // 열리면 첫 항목에 포커스를 둬서 방향키/Enter로 고를 수 있게 한다.
  useEffect(() => {
    if (menu) ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('wheel', close);
    };
  }, [menu, close]);

  const element = menu ? (
    <div
      ref={ref}
      role="menu"
      style={{ left: menu.x, top: menu.y, width: MENU_WIDTH }}
      // 긴 메뉴를 스크롤해도 닫히지 않게(window의 wheel 닫기 리스너까지 올라가지 않는다).
      onWheel={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
      className="fixed z-50 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-popover p-1 text-xs text-popover-foreground shadow-md"
    >
      {menu.items.map((item) => (
        <Fragment key={item.label}>
        {item.separatorBefore && <div role="separator" className="my-1 h-px bg-border" />}
        <button
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            close();
            item.onSelect();
          }}
          className={cn(
            'flex h-7 w-full items-center rounded px-2 text-left transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40',
            item.destructive && 'text-destructive'
          )}
        >
          <item.icon aria-hidden className="mr-2 size-3.5 shrink-0" />
          <span className="truncate">{item.label}</span>
        </button>
        </Fragment>
      ))}
    </div>
  ) : null;

  return { open, element };
}
