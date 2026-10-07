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
  /** 접속 IP가 없는 요청 수(기기를 식별할 수 없는 캡처). */
  untrackedCount?: number;
}

/**
 * 프록시에 실제로 접속한 기기. USB로 꽂지 않은 Wi-Fi 프록시 기기(iOS 수동 설정 등)도 보이고,
 * 트래픽 수신 여부와 CA 신뢰 여부(HTTPS 복호화)를 알려 준다.
 */
const STATE_ORDER = { untrusted: 0, active: 1, idle: 2 } as const;

export function ClientList({ clients, devices, now, proxyRunning, onFilter, activeFilter, onIosSetup, untrackedCount = 0 }: ClientListProps): JSX.Element {
  // 조치가 필요한 기기(인증서 미신뢰)를 맨 위에, 그다음 수신 중, 대기 순(같은 상태는 최근 접속순).
  const sorted = [...clients].sort(
    (a, b) => STATE_ORDER[clientState(a, now)] - STATE_ORDER[clientState(b, now)] || b.lastSeenAt - a.lastSeenAt
  );
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
        접속 중인 기기 ({clients.length})
      </h3>
      {untrackedCount > 0 && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          접속 기기를 알 수 없는 요청 {untrackedCount}건이 있습니다(앱 업데이트 전에 시작한 프록시나 불러온 세션).
          프록시를 <strong className="font-medium">중지 후 다시 시작</strong>하면 이후 요청부터 기기가 표시됩니다.
        </p>
      )}
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
                      {c.platform === 'android' || c.local
                        ? 'HTTPS를 복호화할 수 없습니다. VPN 연결 요청을 허용했는지, 기기에 EverMock CA가 설치(사용자 CA)됐는지 확인하세요. 사용자 CA를 무시하는 앱의 트래픽은 복호화되지 않을 수 있습니다.'
                        : 'HTTPS를 복호화할 수 없습니다. 기기에서 EverMock CA 프로파일 설치와 "인증서 신뢰 설정"(설정 > 일반 > 정보) 활성화를 확인하세요.'}
                      {(c.tlsHostsSinceHttps.length > 0 || c.tlsHostsOther.length > 0) &&
                        ` 실패한 호스트: ${(c.tlsHostsSinceHttps.length > 0 ? c.tlsHostsSinceHttps : c.tlsHostsOther).join(', ')}`}
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
                  {c.tlsErrorsOther === 0
                    ? `iCloud 등 시스템 서비스가 인증서를 고정해 프록시를 거부한 연결 ${c.tlsErrorCount}건입니다(정상, 신뢰 설정과 무관${c.tlsHosts.length > 0 ? `: ${c.tlsHosts.join(', ')}` : ''}).`
                    : `TLS 오류 ${c.tlsErrorCount}건 (인증서를 고정한 앱일 수 있습니다${c.tlsHosts.length > 0 ? `: ${c.tlsHosts.join(', ')}` : ''})`}
                </p>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
