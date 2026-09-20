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
}

/** 기존 Modal API를 shadcn Dialog로 매핑하는 어댑터. */
export function Modal({
  open,
  onOpenChange,
  title,
  children,
  trigger,
  className
}: ModalProps): JSX.Element {
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
