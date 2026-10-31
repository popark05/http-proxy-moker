import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SIDEBAR_SECTIONS } from './sidebar-sections';
import type { SidebarSection } from './sidebar-sections';

interface RailProps {
  section: SidebarSection;
  /** 사이드바가 접혀 있으면 어떤 섹션도 선택된 것으로 보이지 않는다. */
  collapsed: boolean;
  onSelect: (section: SidebarSection) => void;
}

/** 맨 왼쪽 아이콘 줄. 이미 열린 섹션을 다시 누르면 사이드바가 접힌다. */
export function Rail({ section, collapsed, onSelect }: RailProps): JSX.Element {
  return (
    <nav aria-label="섹션" className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-card/60 py-2">
      {SIDEBAR_SECTIONS.map(({ id, label, icon: Icon }) => {
        const selected = !collapsed && section === id;
        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={label}
                aria-pressed={selected}
                onClick={() => onSelect(id)}
                className={cn(
                  'relative flex size-9 items-center justify-center rounded-md transition-colors',
                  selected
                    ? 'bg-primary/15 text-primary before:absolute before:-left-1.5 before:h-5 before:w-0.5 before:rounded-full before:bg-primary'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                )}
              >
                <Icon className="size-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}
