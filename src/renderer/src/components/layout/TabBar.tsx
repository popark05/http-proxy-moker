import { useRef } from 'react';
import { FileJson, FlaskConical, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Tab } from '../../lib/workbench';

/** 메서드별 글자색(목록의 배지 톤과 같은 계열). */
function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'text-primary';
    case 'POST':
      return 'text-[hsl(var(--success))]';
    case 'PUT':
    case 'PATCH':
      return 'text-[hsl(var(--warning))]';
    case 'DELETE':
      return 'text-[hsl(var(--destructive))]';
    default:
      return 'text-muted-foreground';
  }
}

interface TabBarProps {
  tabs: Tab[];
  activeKey: string | undefined;
  /** 탭 표시 정보. 요청 탭은 메서드(색 표시용)와 경로를 따로 준다. */
  describe: (tab: Tab) => { label: string; method?: string };
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  onPin: (key: string) => void;
  onMove: (fromKey: string, toKey: string) => void;
}

/** 워크스페이스 탭 줄. 미리보기 탭은 이탤릭이고, 더블클릭하면 고정된다. 가운데 버튼/× 로 닫고, 드래그로 순서를 바꾼다. */
export function TabBar({ tabs, activeKey, describe, onActivate, onClose, onPin, onMove }: TabBarProps): JSX.Element {
  const dragKey = useRef<string | undefined>(undefined);

  return (
    <div role="tablist" aria-label="열린 탭" className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-card/40">
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        const { label, method } = describe(tab);
        const title = method ? `${method} ${label}` : label;
        return (
          <div
            key={tab.key}
            role="tab"
            aria-selected={active}
            title={title}
            draggable
            onDragStart={() => (dragKey.current = tab.key)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragKey.current) onMove(dragKey.current, tab.key);
              dragKey.current = undefined;
            }}
            onClick={() => onActivate(tab.key)}
            onDoubleClick={() => onPin(tab.key)}
            onAuxClick={(e) => {
              if (e.button === 1) onClose(tab.key);
            }}
            className={cn(
              'group flex min-w-0 max-w-[260px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-3 text-xs transition-colors',
              active
                ? 'border-t-2 border-t-primary bg-background text-foreground'
                : 'border-t-2 border-t-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground'
            )}
          >
            {tab.target.kind === 'mocks' ? (
              <FlaskConical className="size-3.5 shrink-0 text-[hsl(var(--warning))]" />
            ) : method ? (
              <span className={cn('shrink-0 text-2xs font-semibold', methodColor(method))}>{method}</span>
            ) : (
              <FileJson className="size-3.5 shrink-0" />
            )}
            <span className={cn('truncate', !tab.pinned && 'italic')}>{label}</span>
            <button
              type="button"
              aria-label={`${title} 닫기`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.key);
              }}
              className={cn(
                'ml-1 flex size-4 shrink-0 items-center justify-center rounded hover:bg-muted',
                active ? 'opacity-70' : 'opacity-0 group-hover:opacity-70'
              )}
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
