import { useState } from 'react';
import { Tag as TagIcon } from 'lucide-react';
import { Icon } from '@astryxdesign/core/Icon';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';

interface TagEditorProps {
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}

/** exchange 태그 편집: 칩 목록 + 추가 입력(Enter로 추가). */
export function TagEditor({ tags, onAdd, onRemove }: TagEditorProps): React.JSX.Element {
  const [draft, setDraft] = useState('');

  const commit = (): void => {
    const clean = draft.trim();
    if (clean) onAdd(clean);
    setDraft('');
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5">
      <Icon icon={TagIcon} label="태그" />
      {tags.map((tag) => (
        <Token key={tag} label={tag} size="sm" onRemove={() => onRemove(tag)} />
      ))}
      <TextInput
        label="태그 추가"
        isLabelHidden
        size="sm"
        placeholder="태그 추가…"
        value={draft}
        onChange={setDraft}
        onEnter={commit}
        onBlur={commit}
      />
    </div>
  );
}
