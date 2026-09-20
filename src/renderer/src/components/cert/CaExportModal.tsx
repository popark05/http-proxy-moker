import { useEffect, useState } from 'react';
import type { CaInfo } from '@shared/certificate';
import { Modal } from '../primitives';
import { Button } from '@/components/ui/button';

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
      <div className="mb-3">
        <div className="mb-1 text-xs text-muted-foreground">SHA-256 지문</div>
        <div className="break-all font-mono text-[13px] text-foreground">
          {info?.fingerprintSha256 ?? '로딩 중...'}
        </div>
      </div>
      <div className="mb-3">
        <div className="mb-1 text-xs text-muted-foreground">유효기간</div>
        <div className="font-mono text-[13px] text-foreground">
          {info ? new Date(info.notAfter).toLocaleDateString() : '-'}
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <Button size="sm" onClick={() => void onExport('pem')}>
          PEM (Android)
        </Button>
        <Button size="sm" onClick={() => void onExport('mobileconfig')}>
          .mobileconfig (iOS)
        </Button>
      </div>

      {saved && <div className="mt-3 text-xs text-[hsl(var(--success))]">저장됨: {saved}</div>}

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Android: PEM을 기기에 설치(root 기기는 시스템 CA 자동 주입).
        <br />
        iOS: .mobileconfig 설치 후 설정 &gt; 일반 &gt; 정보 &gt; 인증서 신뢰에서 완전 신뢰를
        활성화해야 합니다.
      </p>
    </Modal>
  );
}
