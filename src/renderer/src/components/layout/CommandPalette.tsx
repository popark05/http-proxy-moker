import { useMemo } from 'react';
import { CommandPalette as AstryxCommandPalette } from '@astryxdesign/core/CommandPalette';
import type { SearchSource, SearchableItem } from '@astryxdesign/core/Typeahead';
import { filterCommands } from '../../lib/commands';
import type { Command } from '../../lib/commands';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 열려 있을 때만 만든 전체 항목. */
  commands: Command[];
}

/** 팔레트 항목에 실어 보내는 우리 쪽 데이터. group은 Astryx가 자동으로 소제목으로 묶는다. */
interface ItemData {
  group: string;
  hint?: string;
}

type PaletteItem = SearchableItem<ItemData>;

const toItem = (c: Command): PaletteItem => ({ id: c.id, label: c.label, auxiliaryData: { group: c.group, hint: c.hint } });

/**
 * Cmd/Ctrl+K 커맨드 팔레트(Astryx CommandPalette 어댑터). 검색은 우리 filterCommands(랭킹·그룹 순서)를 그대로 쓰는
 * SearchSource로 연결하고, 항목을 고르면 팔레트를 닫은 뒤 명령을 실행한다.
 */
export function CommandPalette({ open, onOpenChange, commands }: CommandPaletteProps): React.JSX.Element {
  const source = useMemo<SearchSource<PaletteItem>>(
    () => ({
      search: (query) => filterCommands(commands, query).map(toItem),
      bootstrap: () => filterCommands(commands, '').map(toItem)
    }),
    [commands]
  );

  const run = (id: string): void => {
    const command = commands.find((c) => c.id === id);
    if (!command) return;
    onOpenChange(false);
    // 대화상자가 닫히며 포커스를 돌려준 뒤에 실행해야 새로 열린 화면이 포커스를 가져간다.
    setTimeout(command.run, 0);
  };

  // Astryx 팔레트는 방향키로 이동하기 전에는 아무 항목도 강조하지 않아서 "검색어 입력 → Enter"가 동작하지 않는다.
  // 강조된 항목이 없을 때 Enter를 누르면 맨 위 검색 결과를 실행해 기존 사용 흐름을 지킨다.
  const onEnterWithoutHighlight = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Enter') return;
    const input = e.target as HTMLInputElement;
    if (input.getAttribute?.('role') !== 'combobox' || input.getAttribute('aria-activedescendant')) return;
    const first = filterCommands(commands, input.value)[0];
    if (!first) return;
    e.preventDefault();
    e.stopPropagation();
    run(first.id);
  };

  return (
    <span className="contents" onKeyDownCapture={onEnterWithoutHighlight}>
    <AstryxCommandPalette<PaletteItem>
      isOpen={open}
      onOpenChange={onOpenChange}
      searchSource={source}
      label="커맨드 팔레트"
      onValueChange={run}
      emptySearchText="일치하는 항목이 없습니다"
      emptyBootstrapText="탭 · 목 · 시나리오 · 컬렉션 · 요청 검색, 또는 동작 실행"
      renderItem={(item) => (
        <span className="flex w-full items-center gap-2">
          <span className="truncate">{item.label}</span>
          {item.auxiliaryData?.hint && (
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{item.auxiliaryData.hint}</span>
          )}
        </span>
      )}
    />
    </span>
  );
}
