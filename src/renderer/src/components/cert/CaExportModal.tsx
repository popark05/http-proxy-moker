import { useEffect, useState } from 'react';
import styled from 'styled-components';
import type { CaInfo } from '@shared/certificate';
import { Modal, Button } from '../primitives';

const Field = styled.div`
  margin-bottom: ${({ theme }) => theme.space.md};
`;

const Label = styled.div`
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
  color: ${({ theme }) => theme.mutedText};
  margin-bottom: ${({ theme }) => theme.space.xs};
`;

const Value = styled.div`
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: ${({ theme }) => theme.fontSizes.input};
  color: ${({ theme }) => theme.primaryText};
  word-break: break-all;
`;

const Actions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.space.sm};
  margin-top: ${({ theme }) => theme.space.lg};
`;

const Hint = styled.p`
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
  color: ${({ theme }) => theme.secondaryText};
  margin-top: ${({ theme }) => theme.space.md};
  line-height: 1.6;
`;

const Result = styled.div`
  margin-top: ${({ theme }) => theme.space.md};
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
  color: ${({ theme }) => theme.statusSuccess};
`;

interface CaExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CaExportModal({ open, onOpenChange }: CaExportModalProps): JSX.Element {
  const [info, setInfo] = useState<CaInfo | undefined>(undefined);
  const [saved, setSaved] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (open) {
      setSaved(undefined);
      void window.mokerApi.ca.info().then(setInfo);
    }
  }, [open]);

  const onExport = async (format: 'pem' | 'mobileconfig'): Promise<void> => {
    const savedPath = await window.mokerApi.ca.export(format);
    if (savedPath) setSaved(savedPath);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="CA 인증서 내보내기">
      <Field>
        <Label>SHA-256 지문</Label>
        <Value>{info?.fingerprintSha256 ?? '로딩 중...'}</Value>
      </Field>
      <Field>
        <Label>유효기간</Label>
        <Value>{info ? new Date(info.notAfter).toLocaleDateString() : '-'}</Value>
      </Field>

      <Actions>
        <Button $variant="primary" $size="sm" onClick={() => void onExport('pem')}>
          PEM (Android)
        </Button>
        <Button $variant="primary" $size="sm" onClick={() => void onExport('mobileconfig')}>
          .mobileconfig (iOS)
        </Button>
      </Actions>

      {saved && <Result>저장됨: {saved}</Result>}

      <Hint>
        Android: PEM을 기기에 설치(root 기기는 시스템 CA 주입은 Task 4에서 자동화).
        <br />
        iOS: .mobileconfig 설치 후 설정 &gt; 일반 &gt; 정보 &gt; 인증서 신뢰에서 완전 신뢰를 활성화해야 합니다.
      </Hint>
    </Modal>
  );
}
