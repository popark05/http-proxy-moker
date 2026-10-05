import { Apple, Smartphone, HelpCircle, ShieldAlert } from 'lucide-react';
import { clientLabel, clientState, type ClientInfo } from '@shared/clients';
import type { DeviceInfo } from '@shared/device';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/** "방금", "12초 전", "3분 전", "2시간 전". */
export function formatAgo(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 5) return '방금';
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  return `${Math.floor(min / 60)}시간 전`;
}

export function PlatformIcon({ platform, className }: { platform: ClientInfo['platform']; className?: string }): JSX.Element {
  if (platform === 'ios') return <Apple className={className} />;
  if (platform === 'android') return <Smartphone className={className} />;
  return <HelpCircle className={className} />;
}

interface ClientListProps {
  clients: ClientInfo[];
  /** USB로 감지된 기기(이름 붙이기/중복 판단용). */
  devices: DeviceInfo[];
  now: number;
  proxyRunning: boolean;
  /** 이 기기의 요청만 보기. */
  onFilter: (ip: string) => void;
  activeFilter: string | undefined;
  onIosSetup: () => void;
}

/**
 * 프록시에 실제로 접속한 기기. USB로 꽂지 않은 Wi-Fi 프록시 기기(iOS 수동 설정 등)도 보이고,
 * 트래픽 수신 여부와 CA 신뢰 여부(HTTPS 복호화)를 알려 준다.
 */
const STATE_ORDER = { untrusted: 0, active: 1, idle: 2 } as const;

export function ClientList({ clients, devices, now, proxyRunning, onFilter, activeFilter, onIosSetup }: ClientListProps): JSX.Element {
  // 조치가 필요한 기기(인증서 미신뢰)를 맨 위에, 그다음 수신 중, 대기 순(같은 상태는 최근 접속순).
  const sorted = [...clients].sort(
    (a, b) => STATE_ORDER[clientState(a, now)] - STATE_ORDER[clientState(b, now)] || b.lastSeenAt - a.lastSeenAt
  );
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
        접속 중인 기기 ({clients.length})
      </h3>
      {clients.length === 0 ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {proxyRunning
            ? '아직 프록시에 접속한 기기가 없습니다. 기기의 Wi-Fi 프록시를 이 PC 주소로 설정하면 여기에 나타납니다.'
            : '프록시를 시작하면 접속하는 기기가 여기에 나타납니다.'}
        </p>
      ) : (
        sorted.map((c) => {
          const state = clientState(c, now);
          const filtered = activeFilter === c.ip;
          return (
            <div key={c.ip} className="flex flex-col gap-1">
              <div className={`flex items-center gap-2 rounded-md border p-2 ${filtered ? 'border-primary bg-accent' : 'border-border'}`}>
                <PlatformIcon platform={c.platform} className="size-[18px] shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm" title={clientLabel(c, devices, clients)}>
                    {clientLabel(c, devices, clients)}
                  </div>
                  <div className="truncate font-mono text-2xs text-muted-foreground">
                    {c.ip} · {c.requestCount}건 · {formatAgo(now - c.lastSeenAt)}
                  </div>
                </div>
                {state === 'untrusted' ? (
                  <Badge variant="warning">인증서 미신뢰</Badge>
                ) : state === 'active' ? (
                  <Badge variant="success">수신 중</Badge>
                ) : (
                  <Badge variant="neutral">대기</Badge>
                )}
                <Button variant={filtered ? 'secondary' : 'ghost'} size="sm" onClick={() => onFilter(c.ip)} title="이 기기의 요청만 보기">
                  {filtered ? '전체 보기' : '이 기기만'}
                </Button>
              </div>
              {state === 'untrusted' && (
                <div className="flex items-start gap-1.5 text-xs leading-relaxed text-[hsl(var(--warning))]">
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                  <div>
                    <p>
                      HTTPS를 복호화할 수 없습니다. 기기에서 EverMock CA 프로파일 설치와 &quot;인증서 신뢰 설정&quot;(설정 &gt; 일반 &gt; 정보)
                      활성화를 확인하세요.
                      {c.tlsHosts.length > 0 && ` 거부된 호스트: ${c.tlsHosts.join(', ')}`}
                    </p>
                    {/* 요청이 없어 플랫폼을 모르는 기기도 대부분 iOS(수동 설정)라 가이드를 함께 안내한다. */}
                    {c.platform !== 'android' && (
                      <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onIosSetup}>
                        iOS 셋업 가이드 열기
                      </Button>
                    )}
                  </div>
                </div>
              )}
              {state !== 'untrusted' && c.tlsErrorCount > 0 && (
                <p className="text-2xs text-muted-foreground">
                  TLS 오류 {c.tlsErrorCount}건 (인증서를 고정한 앱일 수 있습니다{c.tlsHosts.length > 0 ? `: ${c.tlsHosts.join(', ')}` : ''})
                </p>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
