import { useState } from 'react';
import { X, Tag as TagIcon } from 'lucide-react';

interface TagEditorProps {
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}

/** exchange 태그 편집: 칩 목록 + 추가 입력(Enter로 추가). */
export function TagEditor({ tags, onAdd, onRemove }: TagEditorProps): JSX.Element {
  const [draft, setDraft] = useState('');

  const commit = (): void => {
    const clean = draft.trim();
    if (clean) onAdd(clean);
    setDraft('');
  };

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-1.5">
      <TagIcon className="size-3.5 text-muted-foreground" />
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 font-mono text-xs text-muted-foreground"
        >
          {tag}
          <button
            type="button"
            aria-label={`태그 ${tag} 제거`}
            onClick={() => onRemove(tag)}
            className="inline-flex text-muted-foreground transition-colors hover:text-destructive"
          >
            <X className="size-2.5" />
          </button>
        </span>
      ))}
      <input
        placeholder="태그 추가…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        onBlur={commit}
        aria-label="태그 추가"
        className="min-w-[100px] flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
    </div>
  );
}
