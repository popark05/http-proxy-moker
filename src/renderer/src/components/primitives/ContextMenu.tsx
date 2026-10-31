import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

const MENU_WIDTH = 200;
const ITEM_HEIGHT = 28;

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
  open: (event: React.MouseEvent, items: MenuItem[]) => void;
  element: JSX.Element | null;
} {
  const [menu, setMenu] = useState<OpenMenu | undefined>(undefined);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setMenu(undefined), []);

  const open = useCallback((event: React.MouseEvent, items: MenuItem[]) => {
    event.preventDefault();
    event.stopPropagation();
    if (items.length === 0) return;
    // 화면 밖으로 나가지 않게 오른쪽/아래 끝에서는 안쪽으로 당긴다.
    const x = Math.min(event.clientX, window.innerWidth - MENU_WIDTH - 8);
    const y = Math.min(event.clientY, window.innerHeight - items.length * ITEM_HEIGHT - 16);
    setMenu({ x: Math.max(4, x), y: Math.max(4, y), items });
  }, []);

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
      className="fixed z-50 rounded-md border border-border bg-popover p-1 text-xs text-popover-foreground shadow-md"
    >
      {menu.items.map((item) => (
        <button
          key={item.label}
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
          {item.label}
        </button>
      ))}
    </div>
  ) : null;

  return { open, element };
}
