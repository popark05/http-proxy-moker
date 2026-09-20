import { useEffect, useState } from 'react';
import type { MockDefinition, MockFault } from '@shared/mock';
import { Modal } from '../primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CodeView } from '../code/CodeView';

interface MockEditorProps {
  mock: MockDefinition | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (mock: MockDefinition) => void;
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** 목 정의 편집 모달: method/path/status/헤더/본문(Monaco). */
export function MockEditor({ mock, open, onOpenChange, onSave }: MockEditorProps): JSX.Element {
  const [draft, setDraft] = useState<MockDefinition | undefined>(mock);

  useEffect(() => {
    setDraft(mock);
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
      title="목 편집"
      className="w-[94vw] max-w-none sm:max-w-5xl"
    >
      <div className="mb-3 grid grid-cols-[90px_1fr] items-center gap-2">
        <Label htmlFor="mock-label" className="text-muted-foreground">
          라벨
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
          onChange={(e) => update({ method: e.target.value.toUpperCase() })}
        />

        <Label htmlFor="mock-path" className="text-muted-foreground">
          경로
        </Label>
        <Input
          id="mock-path"
          className="font-mono"
          value={draft.path}
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

          <div className="mb-1 text-xs text-muted-foreground">응답 본문</div>
          <div className="h-[42vh] min-h-[320px] overflow-hidden rounded-md border border-border">
            <CodeView
              value={draft.response.body}
              language="json"
              readOnly={false}
              onChange={(body) => updateResponse({ body })}
            />
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
            onSave(draft);
            onOpenChange(false);
          }}
        >
          저장
        </Button>
      </div>
    </Modal>
  );
}
