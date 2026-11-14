import { useEffect, useState } from 'react';
import { Copy, Power, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { ProxyStatus } from '@shared/capture';
import { DEFAULT_PROXY_PORT } from '@shared/ipc';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { Modal } from '../primitives';
import { TextInput } from '@astryxdesign/core/TextInput';

interface ProxyPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: ProxyStatus;
  busy?: 'starting' | 'stopping';
  onStart: (port?: number) => void;
  onStop: () => void;
  /** 중지 후 (필요하면 새 포트로) 다시 시작. */
  onRestart: (port?: number) => void;
}

/**
 * 프록시 상태/고급 설정. 프록시는 기기 연결이나 목킹을 시작할 때 자동으로 켜지므로 평소에는 열 일이 없고,
 * 포트를 바꾸거나 문제를 확인할 때만 쓴다.
 */
export function ProxyPanel({ open, onOpenChange, status, busy, onStart, onStop, onRestart }: ProxyPanelProps): React.JSX.Element {
  const [port, setPort] = useState(String(status.port ?? DEFAULT_PROXY_PORT));
  const [address, setAddress] = useState<string | undefined>();

  useEffect(() => {
    if (open) setPort(String(status.port ?? DEFAULT_PROXY_PORT));
  }, [open, status.port]);

  // 기기에서 접속할 주소(iOS 수동 설정 안내의 값을 재사용).
  useEffect(() => {
    if (!open || !status.running) {
      setAddress(undefined);
      return;
    }
    let cancelled = false;
    void window.mokerApi.device
      .setupInstructions('ios')
      .then((steps) => {
        if (!cancelled) setAddress(steps.find((s) => s.value)?.value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, status.running, status.port]);

  const parsed = Number(port);
  const portValid = Number.isInteger(parsed) && parsed >= 1024 && parsed <= 65535;
  const changed = status.running && parsed !== status.port;

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="프록시" width={448}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-xs text-muted-foreground">
          프록시는 기기를 연결하거나 목 적용을 켜면 자동으로 켜집니다. 포트를 바꾸거나 문제를 확인할 때만 여기서 다루세요.
        </p>

        <div role="status" className="flex items-center gap-2">
          <span className={`inline-block size-2 rounded-full ${status.running ? 'bg-[hsl(var(--success))]' : 'bg-muted-foreground/50'}`} />
          {busy === 'starting' ? '켜는 중…' : busy === 'stopping' ? '끄는 중…' : status.running ? `포트 ${status.port}에서 수신 중` : '꺼져 있음'}
        </div>

        {status.running && address && (
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
            <span className="text-xs text-muted-foreground">기기에서 접속할 주소</span>
            <code className="ml-auto font-mono text-sm">{address}</code>
            <IconButton
              label="주소 복사"
              icon={<Icon icon={Copy} />}
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(address).then(() => toast.success('주소 복사됨'));
              }}
            />
          </div>
        )}

        <div className="flex items-end gap-2">
          <TextInput
            label="포트"
            width={112}
            controlClassName="font-mono"
            inputMode="numeric"
            value={port}
            status={portValid ? undefined : { type: 'error' }}
            onChange={(v) => setPort(v.replace(/\D/g, ''))}
          />
          {status.running ? (
            <Button
              label={changed ? '포트 바꿔 다시 시작' : '다시 시작'}
              icon={<Icon icon={RefreshCw} />}
              variant="secondary"
              size="sm"
              isDisabled={!!busy || !portValid}
              onClick={() => onRestart(changed ? parsed : undefined)}
            />
          ) : (
            <Button
              label="켜기"
              icon={<Icon icon={Power} />}
              variant="primary"
              size="sm"
              isDisabled={!!busy || !portValid}
              onClick={() => onStart(parsed)}
            />
          )}
          {status.running && (
            <Button
              label="끄기"
              icon={<Icon icon={Power} />}
              variant="secondary"
              size="sm"
              isDisabled={!!busy}
              onClick={onStop}
            />
          )}
        </div>
        {!portValid && (
          <p role="alert" className="text-xs text-destructive">
            1024~65535 사이의 숫자를 입력하세요.
          </p>
        )}
        {status.running && (
          <p className="text-xs text-muted-foreground">
            끄거나 포트를 바꾸면 이미 연결한 기기는 다시 인터셉트해야 할 수 있습니다.
          </p>
        )}
      </div>
    </Modal>
  );
}
