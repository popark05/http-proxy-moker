import type { ReactNode } from 'react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  /** 대화상자 폭(px 또는 CSS 값). 기본은 Astryx 기본값. */
  width?: number | string;
  /** 'tab'이면 대화상자 대신 워크스페이스 탭 안에 본문을 그대로 그린다(open/닫기 버튼 동작은 호출 쪽이 정한다). */
  variant?: 'modal' | 'tab';
}

/** 기존 Modal API를 Astryx Dialog로 매핑하는 어댑터. 편집 대화상자라 입력 후에는 바깥 클릭으로 닫히지 않는다(purpose="form"). */
export function Modal({ open, onOpenChange, title, children, width, variant = 'modal' }: ModalProps): React.JSX.Element {
  if (variant === 'tab') {
    return (
      <div className="mx-auto max-w-4xl p-5">
        <h2 className="mb-3 text-base font-semibold">{title}</h2>
        {children}
      </div>
    );
  }
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={width ?? 560} purpose="form" maxHeight="88dvh">
      <DialogHeader title={title} onOpenChange={onOpenChange} />
      <div className="min-h-0 overflow-auto p-4">{children}</div>
    </Dialog>
  );
}
