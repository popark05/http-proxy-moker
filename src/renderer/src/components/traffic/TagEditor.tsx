import { useState } from 'react';
import styled from 'styled-components';
import { X, Tag as TagIcon } from '@phosphor-icons/react';

const Wrap = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${({ theme }) => theme.space.xs};
  padding: ${({ theme }) => `${theme.space.xs} ${theme.space.md}`};
  border-bottom: 1px solid ${({ theme }) => theme.borderSubtle};
`;

const TagPill = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.xs};
  padding: ${({ theme }) => `2px ${theme.space.sm}`};
  border-radius: ${({ theme }) => theme.radii.pill};
  background: ${({ theme }) => theme.panelRaisedBackground};
  border: 1px solid ${({ theme }) => theme.borderSubtle};
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
  color: ${({ theme }) => theme.secondaryText};
`;

const RemoveBtn = styled.button`
  display: inline-flex;
  border: none;
  background: transparent;
  color: ${({ theme }) => theme.mutedText};
  cursor: pointer;
  padding: 0;
  &:hover {
    color: ${({ theme }) => theme.statusError};
  }
`;

const TagInput = styled.input`
  background: transparent;
  border: none;
  color: ${({ theme }) => theme.primaryText};
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
  min-width: 100px;
  &:focus {
    outline: none;
  }
`;

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
    <Wrap>
      <TagIcon size={14} />
      {tags.map((tag) => (
        <TagPill key={tag}>
          {tag}
          <RemoveBtn aria-label={`태그 ${tag} 제거`} onClick={() => onRemove(tag)}>
            <X size={10} />
          </RemoveBtn>
        </TagPill>
      ))}
      <TagInput
        placeholder="태그 추가…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        onBlur={commit}
        aria-label="태그 추가"
      />
    </Wrap>
  );
}
