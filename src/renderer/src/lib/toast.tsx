import { useToast, type ShowToastFn, type ToastDismissFn } from '@astryxdesign/core/Toast';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * 토스트 모듈. 호출부(상태 훅, withProgress 등)는 컴포넌트 밖이라 Astryx useToast를 직접 쓸 수 없으므로,
 * <ToastBridge />가 훅을 잡아 두고 `toast.success()/error()/loading()/dismiss()`가 그것을 부른다
 * (sonner와 같은 호출 모양을 유지). ToastBridge가 없으면(테스트 등) 조용히 아무것도 하지 않는다.
 */

type Kind = 'success' | 'info' | 'warning' | 'error' | 'loading';
type ToastId = string | number;

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastOptions {
  description?: ReactNode;
  action?: ToastAction;
  cancel?: ToastAction;
  /** 같은 id로 다시 부르면 내용을 갈아끼운다(진행 단계 갱신용). */
  id?: ToastId;
  /** 자동으로 닫히기까지의 ms. 로딩은 닫지 않는다. */
  duration?: number;
}

const ICONS: Record<Kind, { icon: LucideIcon; className: string }> = {
  success: { icon: CheckCircle2, className: 'text-[hsl(var(--success))]' },
  info: { icon: Info, className: 'text-primary' },
  warning: { icon: AlertTriangle, className: 'text-[hsl(var(--warning))]' },
  error: { icon: XCircle, className: 'text-destructive' },
  loading: { icon: Loader2, className: 'animate-spin' }
};

let show: ShowToastFn | undefined;
const dismissers = new Map<string, ToastDismissFn>();
let seq = 0;

/** Astryx useToast 함수를 잡아 두는 브리지. ToastViewport 안(앱 루트 근처)에 한 번 렌더한다. */
export function ToastBridge(): null {
  show = useToast();
  return null;
}

function emit(kind: Kind, title: ReactNode, options: ToastOptions = {}): ToastId {
  const id = options.id ?? `toast-${++seq}`;
  if (!show) return id;
  const key = String(id);
  const { icon, className } = ICONS[kind];
  let close: ToastDismissFn = () => {};
  const actionButton = (a: ToastAction): ReactNode => (
    <Button
      key={a.label}
      label={a.label}
      size="sm"
      variant="ghost"
      onClick={() => {
        a.onClick();
        close();
      }}
    />
  );
  const buttons = [options.action, options.cancel].filter((a): a is ToastAction => !!a);
  close = show({
    uniqueID: key,
    type: kind === 'error' ? 'error' : 'info',
    // 로딩은 직접 닫는다. 오류도 sonner처럼 일정 시간 뒤 닫는다(Astryx 기본은 직접 닫을 때까지 유지).
    isAutoHide: kind !== 'loading',
    autoHideDuration: options.duration ?? (kind === 'error' ? 8000 : 5000),
    body: (
      <span className="flex items-start gap-2">
        <Icon icon={icon} className={`mt-0.5 shrink-0 ${className}`} />
        <span className="flex min-w-0 flex-col">
          <span className="font-medium">{title}</span>
          {options.description && <span className="text-xs opacity-80">{options.description}</span>}
        </span>
      </span>
    ),
    endContent: buttons.length ? <span className="flex items-center gap-1">{buttons.map(actionButton)}</span> : undefined,
    onHide: () => dismissers.delete(key)
  });
  dismissers.set(key, close);
  return id;
}

export const toast = Object.assign((title: ReactNode, options?: ToastOptions): ToastId => emit('info', title, options), {
  success: (title: ReactNode, options?: ToastOptions): ToastId => emit('success', title, options),
  info: (title: ReactNode, options?: ToastOptions): ToastId => emit('info', title, options),
  warning: (title: ReactNode, options?: ToastOptions): ToastId => emit('warning', title, options),
  error: (title: ReactNode, options?: ToastOptions): ToastId => emit('error', title, options),
  loading: (title: ReactNode, options?: ToastOptions): ToastId => emit('loading', title, options),
  /** id를 주면 그 토스트만, 없으면 떠 있는 모든 토스트를 닫는다. */
  dismiss: (id?: ToastId): void => {
    if (id === undefined) {
      dismissers.forEach((close) => close());
      dismissers.clear();
      return;
    }
    const key = String(id);
    dismissers.get(key)?.();
    dismissers.delete(key);
  }
});
