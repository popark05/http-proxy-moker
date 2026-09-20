import { useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { useAppTheme } from '../../theme/ThemeProvider';
import { setupMonaco } from './monaco-setup';

interface CodeViewProps {
  value: string;
  language?: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  height?: string | number;
}

/**
 * Monaco 기반 코드/본문 뷰어·편집기.
 * 읽기 전용(캡처 본문 뷰)과 편집(목 응답 편집, Task 7) 양쪽에 사용.
 */
export function CodeView({
  value,
  language = 'json',
  readOnly = true,
  onChange,
  height = '100%'
}: CodeViewProps): JSX.Element {
  const { themeName } = useAppTheme();

  useEffect(() => {
    setupMonaco();
  }, []);

  return (
    <Editor
      height={height}
      language={language}
      value={value}
      theme={themeName === 'dark' ? 'vs-dark' : 'vs'}
      onChange={(next) => onChange?.(next ?? '')}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontSize: 12,
        fontFamily: '"DM Mono", monospace',
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        lineNumbers: 'on',
        automaticLayout: true
      }}
    />
  );
}
