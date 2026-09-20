import { useEffect, useState } from 'react';
import styled from 'styled-components';
import type { MockDefinition, MockFault } from '@shared/mock';
import { Modal, Button } from '../primitives';
import { CodeView } from '../code/CodeView';

const Grid = styled.div`
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: ${({ theme }) => theme.space.sm};
  align-items: center;
  margin-bottom: ${({ theme }) => theme.space.md};
`;

const Label = styled.label`
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
  color: ${({ theme }) => theme.mutedText};
`;

const Input = styled.input`
  background: ${({ theme }) => theme.panelRaisedBackground};
  color: ${({ theme }) => theme.primaryText};
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.space.xs} ${theme.space.sm}`};
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: ${({ theme }) => theme.fontSizes.input};
  width: 100%;
`;

const Select = styled.select`
  background: ${({ theme }) => theme.panelRaisedBackground};
  color: ${({ theme }) => theme.primaryText};
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.space.xs} ${theme.space.sm}`};
  font-family: ${({ theme }) => theme.fonts.sans};
  font-size: ${({ theme }) => theme.fontSizes.input};
  width: 100%;
`;

const FaultNote = styled.div`
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
  color: ${({ theme }) => theme.statusWarning};
  margin-bottom: ${({ theme }) => theme.space.md};
`;

const BodyLabel = styled.div`
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
  color: ${({ theme }) => theme.mutedText};
  margin-bottom: ${({ theme }) => theme.space.xs};
`;

const BodyWrap = styled.div`
  height: 260px;
  border: 1px solid ${({ theme }) => theme.borderSubtle};
  border-radius: ${({ theme }) => theme.radii.sm};
  overflow: hidden;
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: ${({ theme }) => theme.space.sm};
  margin-top: ${({ theme }) => theme.space.lg};
`;

interface MockEditorProps {
  mock: MockDefinition | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (mock: MockDefinition) => void;
}

/** 목 정의 편집 모달: method/path/status/헤더/본문(Monaco). */
export function MockEditor({ mock, open, onOpenChange, onSave }: MockEditorProps): JSX.Element {
  const [draft, setDraft] = useState<MockDefinition | undefined>(mock);

  useEffect(() => {
    setDraft(mock);
  }, [mock]);

  if (!draft) {
    return <Modal open={open} onOpenChange={onOpenChange} title="목 편집" children={<div />} />;
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
    <Modal open={open} onOpenChange={onOpenChange} title="목 편집">
      <Grid>
        <Label htmlFor="mock-label">라벨</Label>
        <Input
          id="mock-label"
          value={draft.label}
          onChange={(e) => update({ label: e.target.value })}
        />

        <Label htmlFor="mock-method">메서드</Label>
        <Input
          id="mock-method"
          value={draft.method}
          onChange={(e) => update({ method: e.target.value.toUpperCase() })}
        />

        <Label htmlFor="mock-path">경로</Label>
        <Input
          id="mock-path"
          value={draft.path}
          onChange={(e) => update({ path: e.target.value })}
        />

        <Label htmlFor="mock-status">상태코드</Label>
        <Input
          id="mock-status"
          type="number"
          value={draft.response.status}
          disabled={hasFault}
          onChange={(e) => updateResponse({ status: parseInt(e.target.value, 10) || 200 })}
        />

        <Label htmlFor="mock-delay">지연(ms)</Label>
        <Input
          id="mock-delay"
          type="number"
          min={0}
          value={draft.delayMs ?? 0}
          onChange={(e) => update({ delayMs: Math.max(0, parseInt(e.target.value, 10) || 0) })}
        />

        <Label htmlFor="mock-fault">에러 주입</Label>
        <Select
          id="mock-fault"
          value={draft.fault ?? 'none'}
          onChange={(e) => update({ fault: e.target.value as MockFault })}
        >
          <option value="none">없음 (정상 응답)</option>
          <option value="timeout">타임아웃 (응답 없이 대기)</option>
          <option value="reset">연결 리셋 (RST)</option>
          <option value="close">연결 종료</option>
        </Select>
      </Grid>

      {hasFault ? (
        <FaultNote>
          에러 주입이 설정되어 응답(상태/헤더/본문) 대신 지정한 네트워크 오류가 반환됩니다.
        </FaultNote>
      ) : (
        <>
          <BodyLabel>응답 헤더 (한 줄에 하나: Name: Value)</BodyLabel>
          <BodyWrap style={{ height: 120 }}>
            <CodeView
              value={headersText}
              language="plaintext"
              readOnly={false}
              onChange={applyHeaders}
            />
          </BodyWrap>

          <div style={{ height: 12 }} />

          <BodyLabel>응답 본문</BodyLabel>
          <BodyWrap>
            <CodeView
              value={draft.response.body}
              language="json"
              readOnly={false}
              onChange={(body) => updateResponse({ body })}
            />
          </BodyWrap>
        </>
      )}

      <Actions>
        <Button $variant="ghost" $size="sm" onClick={() => onOpenChange(false)}>
          취소
        </Button>
        <Button
          $variant="primary"
          $size="sm"
          onClick={() => {
            onSave(draft);
            onOpenChange(false);
          }}
        >
          저장
        </Button>
      </Actions>
    </Modal>
  );
}
