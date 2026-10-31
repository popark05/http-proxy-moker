import type { ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  trigger?: ReactNode;
  /** DialogContent에 덧붙일 클래스(폭/높이 조절 등). */
  className?: string;
  /** 'tab'이면 대화상자 대신 워크스페이스 탭 안에 본문을 그대로 그린다(open/닫기 버튼 동작은 호출 쪽이 정한다). */
  variant?: 'modal' | 'tab';
}

/** 기존 Modal API를 shadcn Dialog로 매핑하는 어댑터. */
export function Modal({
  open,
  onOpenChange,
  title,
  children,
  trigger,
  className,
  variant = 'modal'
}: ModalProps): JSX.Element {
  if (variant === 'tab') {
    return (
      <div className="mx-auto max-w-4xl p-5">
        <h2 className="mb-3 text-base font-semibold">{title}</h2>
        {children}
      </div>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className={cn('max-h-[85vh] overflow-auto', className)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
