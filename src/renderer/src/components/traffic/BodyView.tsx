import { useState } from 'react';
import type { CapturedBody } from '@shared/capture';
import { displayableImageMime, isSvgText, toDataUrl } from '@shared/image-body';
import { Button } from '@/components/ui/button';
import { CodeView } from '../code/CodeView';
import { ImagePreview } from './ImagePreview';

function Note({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="p-3 text-sm text-muted-foreground">{children}</div>;
}

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
  const imageMime = displayableImageMime(body);
  if (imageMime) {
    return (
      <ImagePreview
        src={toDataUrl(imageMime, body.content, 'base64')}
        mime={imageMime}
        byteLength={body.byteLength}
      />
    );
  }
  if (isSvgText(body)) return <SvgBody body={body} />;
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

/** SVG는 텍스트로 캡처되므로 미리보기(기본)와 소스 보기를 전환할 수 있게 한다. */
function SvgBody({ body }: { body: CapturedBody }): JSX.Element {
  const [view, setView] = useState<'preview' | 'code'>('preview');
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-1 border-b border-border px-3 py-1">
        <Button variant={view === 'preview' ? 'secondary' : 'ghost'} size="sm" onClick={() => setView('preview')}>
          미리보기
        </Button>
        <Button variant={view === 'code' ? 'secondary' : 'ghost'} size="sm" onClick={() => setView('code')}>
          소스
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        {view === 'preview' ? (
          <ImagePreview
            src={toDataUrl('image/svg+xml', body.content, 'text')}
            mime="image/svg+xml"
            byteLength={body.byteLength}
          />
        ) : (
          <CodeView value={body.content} language="xml" readOnly />
        )}
      </div>
    </div>
  );
}
