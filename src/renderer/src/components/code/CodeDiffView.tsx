import { DiffEditor } from '@monaco-editor/react';
// import 시점에 monaco를 로컬 번들로 설정(Editor 마운트 전 보장).
import './monaco-setup';

interface CodeDiffViewProps {
  /** 원본(왼쪽). */
  original: string;
  /** 수정본(오른쪽). */
  modified: string;
  language?: string;
}

/** 원본 vs 수정본 diff 뷰(읽기 전용). 변경된 줄을 하이라이트한다. */
export function CodeDiffView({
  original,
  modified,
  language = 'json'
}: CodeDiffViewProps): JSX.Element {
  return (
    <DiffEditor
      height="100%"
      language={language}
      original={original}
      modified={modified}
      theme="vs-dark"
      options={{
        readOnly: true,
        renderSideBySide: true,
        minimap: { enabled: false },
        fontSize: 12,
        fontFamily: '"DM Mono", monospace',
        scrollBeyondLastLine: false,
        // diff는 줄 정렬 정확도를 위해 wrap을 끄고 가로 스크롤한다.
        wordWrap: 'off',
        lineNumbers: 'on',
        automaticLayout: true,
        diffWordWrap: 'off'
      }}
    />
  );
}
