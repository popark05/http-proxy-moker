import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { filterCommands } from '../../lib/commands';
import type { Command } from '../../lib/commands';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 열려 있을 때만 만든 전체 항목. */
  commands: Command[];
}

/** Cmd/Ctrl+K 커맨드 팔레트. 입력으로 탭·목·시나리오·계약·요청·동작을 찾아 Enter로 실행한다. */
export function CommandPalette({ open, onOpenChange, commands }: CommandPaletteProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => filterCommands(commands, query), [commands, query]);

  // 열 때마다 처음 상태로.
  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
    }
  }, [open]);

  useEffect(() => setIndex(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected=true]')?.scrollIntoView?.({ block: 'nearest' });
  }, [index, results]);

  const run = (command: Command | undefined): void => {
    if (!command) return;
    onOpenChange(false);
    // 대화상자가 닫히며 포커스를 돌려준 뒤에 실행해야 새로 열린 화면이 포커스를 가져간다.
    setTimeout(command.run, 0);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(results[index]);
    }
  };

  let lastGroup = '';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[18%] max-w-xl -translate-y-0 gap-0 overflow-hidden p-0 [&>button]:hidden">
        <DialogTitle className="sr-only">커맨드 팔레트</DialogTitle>
        <DialogDescription className="sr-only">
          탭, 목, 시나리오, 계약, 요청을 찾아 열거나 동작을 실행합니다.
        </DialogDescription>
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls="command-list"
            aria-activedescendant={results[index] ? `command-${index}` : undefined}
            aria-label="명령 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="탭 · 목 · 시나리오 · 계약 · 요청 검색, 또는 동작 실행"
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div
          id="command-list"
          ref={listRef}
          role="listbox"
          aria-label="검색 결과"
          className="max-h-[50vh] overflow-auto py-1"
        >
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">일치하는 항목이 없습니다</p>
          ) : (
            results.map((command, i) => {
              const header = command.group !== lastGroup ? command.group : undefined;
              lastGroup = command.group;
              return (
                <div key={command.id}>
                  {header && (
                    <div className="px-3 pb-0.5 pt-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                      {header}
                    </div>
                  )}
                  <div
                    id={`command-${i}`}
                    role="option"
                    aria-selected={i === index}
                    onMouseMove={() => setIndex(i)}
                    onClick={() => run(command)}
                    className={cn(
                      'flex h-8 cursor-pointer items-center gap-2 px-3 text-sm',
                      i === index ? 'bg-primary/15 text-foreground' : 'text-foreground/90'
                    )}
                  >
                    <span className="truncate">{command.label}</span>
                    {command.hint && (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{command.hint}</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
