import { useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ImagePreviewProps {
  src: string;
  mime: string;
  byteLength: number;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n.toLocaleString()} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** 투명 영역이 보이도록 체크무늬 배경을 깐 이미지 미리보기. 맞춤/원본 크기 전환 + 해상도 표시. */
export function ImagePreview({ src, mime, byteLength }: ImagePreviewProps): JSX.Element {
  const [fit, setFit] = useState(true);
  const [size, setSize] = useState<{ w: number; h: number } | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const label = mime.replace('image/', '').replace('svg+xml', 'svg').toUpperCase();

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        <span>
          {label}
          {size ? ` · ${size.w}×${size.h}` : ''} · {formatBytes(byteLength)}
        </span>
        <div className="flex-1" />
        {!failed && (
          <Button variant="ghost" size="sm" onClick={() => setFit((v) => !v)}>
            {fit ? <Maximize2 /> : <Minimize2 />}
            {fit ? '원본 크기' : '창에 맞춤'}
          </Button>
        )}
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto p-3"
        // 체크무늬(투명 PNG/SVG 확인용). 색은 테마와 무관한 중립 회색.
        style={{
          backgroundColor: '#2a2d35',
          backgroundImage:
            'linear-gradient(45deg,#343843 25%,transparent 25%,transparent 75%,#343843 75%),' +
            'linear-gradient(45deg,#343843 25%,transparent 25%,transparent 75%,#343843 75%)',
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 8px 8px'
        }}
      >
        {failed ? (
          <div className="rounded-md bg-background/90 p-3 text-sm text-muted-foreground">
            이미지를 표시할 수 없습니다(손상되었거나 지원하지 않는 형식, {mime}).
          </div>
        ) : (
          <img
            src={src}
            alt="응답 본문 이미지"
            onLoad={(e) =>
              setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
            onError={() => setFailed(true)}
            className={fit ? 'mx-auto max-h-full max-w-full object-contain' : 'max-w-none'}
            draggable={false}
          />
        )}
      </div>
    </div>
  );
}
