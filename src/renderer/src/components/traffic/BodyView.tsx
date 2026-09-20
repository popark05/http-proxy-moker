import styled from 'styled-components';
import type { CapturedBody } from '@shared/capture';
import { CodeView } from '../code/CodeView';

const Note = styled.div`
  padding: ${({ theme }) => theme.space.md};
  color: ${({ theme }) => theme.mutedText};
  font-size: ${({ theme }) => theme.fontSizes.input};
`;

function languageFor(contentType?: string): string {
  if (!contentType) return 'plaintext';
  if (contentType.includes('json')) return 'json';
  if (contentType.includes('html')) return 'html';
  if (contentType.includes('xml')) return 'xml';
  if (contentType.includes('javascript')) return 'javascript';
  return 'plaintext';
}

/** JSON이면 보기 좋게 들여쓰기 시도. 실패하면 원본 유지. */
function prettify(content: string, language: string): string {
  if (language !== 'json') return content;
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

export function BodyView({ body }: { body: CapturedBody }): JSX.Element {
  if (body.encoding === 'empty') {
    return <Note>본문 없음</Note>;
  }
  if (body.encoding === 'omitted') {
    return <Note>본문이 커서 생략됨 ({body.byteLength.toLocaleString()} 바이트)</Note>;
  }
  if (body.encoding === 'base64') {
    return (
      <Note>
        이진 본문 ({body.byteLength.toLocaleString()} 바이트, {body.contentType ?? '알 수 없음'})
      </Note>
    );
  }

  const language = languageFor(body.contentType);
  return <CodeView value={prettify(body.content, language)} language={language} readOnly />;
}
