import { useEffect, useRef, useState } from 'react';
import { GitCompare, ImageUp, Pencil } from 'lucide-react';
import type { MockDefinition, MockFault } from '@shared/mock';
import { isBodyModified } from '@shared/mock';
import { Modal } from '../primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CodeView } from '../code/CodeView';
import { CodeDiffView } from '../code/CodeDiffView';
import { ImagePreview } from '../traffic/ImagePreview';
import { displayableImageMime, toDataUrl } from '@shared/image-body';
import { fileToBase64 } from '@/lib/file';

/** 파일로 교체할 수 있는 최대 크기. 본문은 IPC로 워커에 전달되므로 과도한 크기는 막는다. */
const MAX_REPLACE_BYTES = 2 * 1024 * 1024;

interface MockEditorProps {
  mock: MockDefinition | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (mock: MockDefinition) => void;
  /** 케이스 편집처럼 method/path를 바꾸지 않을 때(엔드포인트 고정). */
  lockEndpoint?: boolean;
  /** 이름 입력 라벨(기본 "라벨"). */
  nameLabel?: string;
  title?: string;
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** JSON이면 보기 좋게 들여쓴다(아니면 원본 유지). */
function prettifyJson(body: string): string {
  if (!body || !body.trim()) return body;
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

/** 편집 초기값용: 응답 본문을 들여쓰기한 목을 반환. */
function prettifyJsonBody(mock: MockDefinition): MockDefinition {
  // base64 본문은 JSON이 아니다(숫자처럼 보이는 문자열이 변형되지 않게 건너뜀).
  if (mock.response.bodyEncoding === 'base64') return mock;
  const formatted = prettifyJson(mock.response.body);
  if (formatted === mock.response.body) return mock;
  return { ...mock, response: { ...mock.response, body: formatted } };
}

/** 목 정의 편집 모달: method/path/status/헤더/본문(Monaco). */
export function MockEditor({
  mock,
  open,
  onOpenChange,
  onSave,
  lockEndpoint = false,
  nameLabel = '라벨',
  title = '목 편집'
}: MockEditorProps): JSX.Element {
  const [draft, setDraft] = useState<MockDefinition | undefined>(mock);
  const [showDiff, setShowDiff] = useState(false);
  const [replaceError, setReplaceError] = useState<string | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 모달이 열릴 때 본문 JSON을 들여쓰기해 구조가 보이게 한다. diff 토글은 초기화.
  useEffect(() => {
    setDraft(mock ? prettifyJsonBody(mock) : mock);
    setShowDiff(false);
    setReplaceError(undefined);
  }, [mock]);

  if (!draft) {
    return (
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title="목 편집"
        className="w-[94vw] max-w-none sm:max-w-5xl"
        children={<div />}
      />
    );
  }

  const update = (patch: Partial<MockDefinition>): void => setDraft({ ...draft, ...patch });
  const updateResponse = (patch: Partial<MockDefinition['response']>): void =>
    setDraft({ ...draft, response: { ...draft.response, ...patch } });

  const hasFault = !!draft.fault && draft.fault !== 'none';
  const isBinary = draft.response.bodyEncoding === 'base64';
  const contentTypeHeader = draft.response.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1];

  /** 이진 본문을 선택한 파일로 교체하고 Content-Type을 파일 형식에 맞춘다. */
  const replaceWithFile = async (file: File): Promise<void> => {
    if (file.size > MAX_REPLACE_BYTES) {
      setReplaceError(`파일이 너무 큽니다(최대 ${MAX_REPLACE_BYTES / 1024 / 1024}MB).`);
      return;
    }
    setReplaceError(undefined);
    const body = await fileToBase64(file);
    const headers = draft.response.headers.filter(([k]) => k.toLowerCase() !== 'content-type');
    // content-length는 원본 크기라 어긋나므로 제거(mockttp가 실제 길이로 채운다).
    const cleaned = headers.filter(([k]) => k.toLowerCase() !== 'content-length');
    if (file.type) cleaned.push(['content-type', file.type]);
    setDraft({ ...draft, response: { ...draft.response, body, bodyEncoding: 'base64', headers: cleaned } });
  };
  const headersText = draft.response.headers.map(([k, v]) => `${k}: ${v}`).join('\n');

  const applyHeaders = (text: string): void => {
    const headers: Array<[string, string]> = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf(':');
        return idx >= 0
          ? ([line.slice(0, idx).trim(), line.slice(idx + 1).trim()] as [string, string])
          : ([line, ''] as [string, string]);
      });
    updateResponse({ headers });
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      className="w-[94vw] max-w-none sm:max-w-5xl"
    >
      <div className="mb-3 grid grid-cols-[90px_1fr] items-center gap-2">
        <Label htmlFor="mock-label" className="text-muted-foreground">
          {nameLabel}
        </Label>
        <Input
          id="mock-label"
          className="font-mono"
          value={draft.label}
          onChange={(e) => update({ label: e.target.value })}
        />

        <Label htmlFor="mock-method" className="text-muted-foreground">
          메서드
        </Label>
        <Input
          id="mock-method"
          className="font-mono"
          value={draft.method}
          disabled={lockEndpoint}
          onChange={(e) => update({ method: e.target.value.toUpperCase() })}
        />

        <Label htmlFor="mock-path" className="text-muted-foreground">
          경로
        </Label>
        <Input
          id="mock-path"
          className="font-mono"
          value={draft.path}
          disabled={lockEndpoint}
          onChange={(e) => update({ path: e.target.value })}
        />

        <Label htmlFor="mock-status" className="text-muted-foreground">
          상태코드
        </Label>
        <Input
          id="mock-status"
          type="number"
          className="font-mono"
          value={draft.response.status}
          disabled={hasFault}
          onChange={(e) => updateResponse({ status: parseInt(e.target.value, 10) || 200 })}
        />

        <Label htmlFor="mock-delay" className="text-muted-foreground">
          지연(ms)
        </Label>
        <Input
          id="mock-delay"
          type="number"
          min={0}
          className="font-mono"
          value={draft.delayMs ?? 0}
          onChange={(e) => update({ delayMs: Math.max(0, parseInt(e.target.value, 10) || 0) })}
        />

        <Label htmlFor="mock-fault" className="text-muted-foreground">
          에러 주입
        </Label>
        <select
          id="mock-fault"
          className={selectClass}
          value={draft.fault ?? 'none'}
          onChange={(e) => update({ fault: e.target.value as MockFault })}
        >
          <option value="none">없음 (정상 응답)</option>
          <option value="timeout">타임아웃 (응답 없이 대기)</option>
          <option value="reset">연결 리셋 (RST)</option>
          <option value="close">연결 종료</option>
        </select>
      </div>

      {hasFault ? (
        <div className="mb-3 text-xs text-[hsl(var(--warning))]">
          에러 주입이 설정되어 응답(상태/헤더/본문) 대신 지정한 네트워크 오류가 반환됩니다.
        </div>
      ) : (
        <>
          <div className="mb-1 text-xs text-muted-foreground">
            응답 헤더 (한 줄에 하나: Name: Value)
          </div>
          <div className="h-[160px] overflow-hidden rounded-md border border-border">
            <CodeView
              value={headersText}
              language="plaintext"
              readOnly={false}
              onChange={applyHeaders}
            />
          </div>

          <div className="h-3" />

          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">응답 본문</span>
            {draft.originalBody !== undefined && !isBinary && (
              <div className="flex items-center gap-2">
                {isBodyModified(draft) && (
                  <span className="text-xs text-primary">원본에서 수정됨</span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7"
                  onClick={() => setShowDiff((v) => !v)}
                >
                  {showDiff ? (
                    <>
                      <Pencil /> 편집으로
                    </>
                  ) : (
                    <>
                      <GitCompare /> 원본과 비교
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
          <div className="h-[42vh] min-h-[320px] overflow-hidden rounded-md border border-border">
            {isBinary ? (
              <div className="flex h-full flex-col">
                <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
                  <span>
                    이진 본문은 텍스트로 편집할 수 없습니다. 다른 파일로 교체할 수 있습니다.
                    {isBodyModified(draft) ? ' (원본에서 교체됨)' : ''}
                  </span>
                  <div className="flex-1" />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={contentTypeHeader?.startsWith('image/') ? 'image/*' : undefined}
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = ''; // 같은 파일을 다시 골라도 change가 오도록 초기화
                      if (file) void replaceWithFile(file);
                    }}
                  />
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    <ImageUp /> 파일로 교체
                  </Button>
                </div>
                {replaceError && <div className="px-3 py-1 text-xs text-destructive">{replaceError}</div>}
                <div className="min-h-0 flex-1">
                  <BinaryBody body={draft.response.body} contentType={contentTypeHeader} />
                </div>
              </div>
            ) : showDiff && draft.originalBody !== undefined ? (
              <CodeDiffView
                original={prettifyJson(draft.originalBody)}
                modified={draft.response.body}
                language="json"
              />
            ) : (
              <CodeView
                value={draft.response.body}
                language="json"
                readOnly={false}
                onChange={(body) => updateResponse({ body })}
              />
            )}
          </div>
        </>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          취소
        </Button>
        <Button
          size="sm"
          onClick={() => {
            // 저장 시에도 JSON이면 pretty-print해 포맷을 일관되게 유지.
            onSave({
              ...draft,
              response: {
                ...draft.response,
                body: isBinary ? draft.response.body : prettifyJson(draft.response.body)
              }
            });
            onOpenChange(false);
          }}
        >
          저장
        </Button>
      </div>
    </Modal>
  );
}

/** 이진 본문 미리보기: 이미지면 그림으로, 아니면 크기만 안내한다. */
function BinaryBody({ body, contentType }: { body: string; contentType?: string }): JSX.Element {
  const byteLength = Math.floor((body.length * 3) / 4) - (body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0);
  const mime = displayableImageMime({ encoding: 'base64', content: body, byteLength, contentType });
  if (mime) return <ImagePreview src={toDataUrl(mime, body, 'base64')} mime={mime} byteLength={byteLength} />;
  return (
    <div className="p-3 text-sm text-muted-foreground">
      이진 본문 ({byteLength.toLocaleString()} 바이트, {contentType ?? '알 수 없음'})
    </div>
  );
}
