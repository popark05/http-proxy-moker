/**
 * 기기 연결 마법사의 단계 진행 상태.
 *
 * 앱이 아는 실제 상태(프록시 실행, 기기 목록, 인터셉션 결과, 프록시가 본 접속 기기)에서 각 단계의
 * 완료/현재/막힘을 계산한다. 기기에서 사람이 직접 하는 단계("수동")는 앱이 직접 확인할 수 없으므로,
 * 뒤 단계의 증거(예: 트래픽 수신)가 있으면 앞 단계도 끝난 것으로 본다. 순수 로직만 둔다(테스트 가능).
 */
import type { DeviceInfo, InterceptionResult } from './device';
import { clientState, type ClientInfo } from './clients';

export type WizardTab = 'android-usb' | 'android-wifi-adb' | 'android-wifi-manual' | 'ios-wifi';

export type StepStatus = 'done' | 'current' | 'pending' | 'blocked';

export interface WizardInput {
  proxyRunning: boolean;
  /** 기기가 프록시로 접속할 주소("192.168.0.5:8080"). 모르면 undefined. */
  proxyAddress?: string;
  devices: readonly DeviceInfo[];
  interceptions: Readonly<Record<string, InterceptionResult>>;
  clients: readonly ClientInfo[];
  now: number;
}

export interface WizardStep {
  id: string;
  title: string;
  detail: string;
  /** auto: 앱이 수행/확인, manual: 사용자가 기기·PC에서 직접 수행. */
  kind: 'auto' | 'manual';
  status: StepStatus;
  /** 막힘/주의 사유(status가 blocked일 때). */
  reason?: string;
  /** 보여줄 값(프록시 주소 등). */
  value?: string;
}

interface Evidence {
  /** 이 단계가 끝났다는 증거가 있는가. */
  done: boolean;
  /** 막힌 사유(있으면 이 단계가 current일 때 blocked로 표시). */
  blocked?: string;
}

interface StepDef {
  id: string;
  title: string;
  detail: string;
  kind: 'auto' | 'manual';
  value?: (input: WizardInput) => string | undefined;
  evidence: (input: WizardInput) => Evidence;
}

const androidDevices = (i: WizardInput): DeviceInfo[] => i.devices.filter((d) => d.platform === 'android');
const iosDevices = (i: WizardInput): DeviceInfo[] => i.devices.filter((d) => d.platform === 'ios');
/** USB 터널(127.0.0.1)로 들어온 접속. */
const localClients = (i: WizardInput): ClientInfo[] => i.clients.filter((c) => c.local);
/** 자기 IP로 직접 들어온 Wi-Fi 접속(플랫폼 필터). */
const wifiClients = (i: WizardInput, platform: 'android' | 'ios'): ClientInfo[] =>
  i.clients.filter((c) => !c.local && (c.platform === platform || c.platform === 'unknown'));

const hasLanIp = (i: WizardInput): boolean => !!i.proxyAddress && !i.proxyAddress.startsWith('127.');

const proxyStep: StepDef = {
  id: 'proxy',
  title: '프록시 시작',
  detail: '상단의 "프록시 시작"을 눌러 캡처 프록시를 켭니다.',
  kind: 'auto',
  evidence: (i) => ({ done: i.proxyRunning })
};

const usbDebugStep: StepDef = {
  id: 'usb-debug',
  title: 'USB로 연결하고 USB 디버깅 허용',
  detail:
    '개발자 옵션에서 USB 디버깅을 켜고 케이블로 연결하세요. 기기에 뜨는 "USB 디버깅을 허용하시겠습니까?"에서 허용을 누릅니다.',
  kind: 'manual',
  evidence: (i) => {
    const list = androidDevices(i);
    if (list.some((d) => d.status === 'ready')) return { done: true };
    const bad = list.find((d) => d.status !== 'ready');
    if (bad) {
      const why =
        bad.status === 'unauthorized'
          ? '기기 화면에서 USB 디버깅 허용을 눌러 주세요.'
          : bad.statusDetail || '기기가 오프라인입니다. 케이블을 다시 연결해 보세요.';
      return { done: false, blocked: bad.statusDetail && bad.status === 'unauthorized' ? `${why} (${bad.statusDetail})` : why };
    }
    return { done: false };
  }
};

function interceptStep(path: 'usb' | 'wifi'): StepDef {
  return {
    id: 'intercept',
    title: `"인터셉트" 누르기 (트래픽 경로: ${path === 'usb' ? 'USB 터널' : 'Wi-Fi'})`,
    detail:
      path === 'usb'
        ? '기기 항목에서 트래픽 경로를 "USB 터널"로 두고 인터셉트를 누르면 adb reverse 터널이 열리고 VPN 앱이 설치·실행됩니다.'
        : '기기 항목에서 트래픽 경로를 "Wi-Fi"로 바꾼 뒤 인터셉트를 누르면 PC의 LAN IP로 프록시가 설정됩니다. adb는 제어용으로만 쓰입니다.',
    kind: 'auto',
    evidence: (i) => {
      const results = androidDevices(i)
        .map((d) => i.interceptions[d.id])
        .filter((r): r is InterceptionResult => !!r);
      if (results.length === 0) return { done: false };
      if (results.some((r) => r.proxyConfigured)) return { done: true };
      return { done: false, blocked: results[0].warnings[0] ?? '인터셉션을 시작하지 못했습니다.' };
    }
  };
}

const vpnAllowStep: StepDef = {
  id: 'vpn-allow',
  title: 'VPN 연결 요청 허용',
  detail: '기기 화면에 뜨는 "연결 요청"(VPN) 대화상자에서 확인을 누르세요. 허용해야 트래픽이 프록시로 들어옵니다.',
  kind: 'manual',
  evidence: () => ({ done: false })
};

function trafficStep(find: (i: WizardInput) => ClientInfo[], where: string): StepDef {
  return {
    id: 'traffic',
    title: '트래픽 수신 확인',
    detail: `기기에서 앱이나 브라우저를 열어 보세요. 아래 "접속 중인 기기"에 ${where}가 나타나고 요청 수가 올라가면 연결된 것입니다.`,
    kind: 'auto',
    evidence: (i) => ({ done: find(i).some((c) => c.requestCount > 0) })
  };
}

function decryptStep(find: (i: WizardInput) => ClientInfo[], untrustedHint: string): StepDef {
  return {
    id: 'https',
    title: 'HTTPS 복호화 확인',
    detail: 'HTTPS 요청이 목록에 내용과 함께 보이면 인증서 신뢰까지 끝난 것입니다.',
    kind: 'auto',
    evidence: (i) => {
      const found = find(i);
      if (found.some((c) => c.httpsCount > 0)) return { done: true };
      if (found.some((c) => clientState(c, i.now) === 'untrusted')) return { done: false, blocked: untrustedHint };
      return { done: false };
    }
  };
}

const ANDROID_UNTRUSTED =
  'HTTPS가 복호화되지 않습니다. 사용자 CA를 무시하는 앱의 트래픽은 복호화되지 않을 수 있습니다. 브라우저 등으로 확인해 보세요.';
const IOS_UNTRUSTED =
  'CA 프로파일 설치와 "인증서 신뢰 설정"(설정 > 일반 > 정보) 활성화를 확인하세요.';

const TABS: Record<WizardTab, StepDef[]> = {
  'android-usb': [
    proxyStep,
    usbDebugStep,
    interceptStep('usb'),
    vpnAllowStep,
    trafficStep(localClients, '"USB 연결" 기기'),
    decryptStep(localClients, ANDROID_UNTRUSTED)
  ],
  'android-wifi-adb': [
    proxyStep,
    {
      id: 'lan',
      title: 'PC와 기기를 같은 Wi-Fi에 연결',
      detail: 'PC와 Android 기기가 같은 공유기(같은 네트워크)에 있어야 합니다. 게스트 Wi-Fi는 기기 간 통신이 막힐 수 있습니다.',
      kind: 'manual',
      value: (i) => i.proxyAddress,
      evidence: (i) => (i.proxyAddress && !hasLanIp(i) ? { done: false, blocked: 'PC의 LAN IP를 찾지 못했습니다. Wi-Fi/이더넷 연결을 확인하세요.' } : { done: false })
    },
    usbDebugStep,
    interceptStep('wifi'),
    vpnAllowStep,
    trafficStep((i) => wifiClients(i, 'android'), '기기의 Wi-Fi IP'),
    decryptStep((i) => wifiClients(i, 'android'), ANDROID_UNTRUSTED)
  ],
  'android-wifi-manual': [
    proxyStep,
    {
      id: 'lan',
      title: 'PC와 기기를 같은 Wi-Fi에 연결',
      detail: 'PC와 Android 기기가 같은 네트워크에 있어야 합니다.',
      kind: 'manual',
      evidence: (i) => (i.proxyAddress && !hasLanIp(i) ? { done: false, blocked: 'PC의 LAN IP를 찾지 못했습니다. Wi-Fi/이더넷 연결을 확인하세요.' } : { done: false })
    },
    {
      id: 'wifi-proxy',
      title: 'Wi-Fi 프록시를 수동으로 설정',
      detail: '설정 > Wi-Fi > (연결된 네트워크) > 수정 > 고급 옵션 > 프록시: 수동. 호스트 이름과 포트를 아래 값으로 입력하세요.',
      kind: 'manual',
      value: (i) => i.proxyAddress,
      evidence: () => ({ done: false })
    },
    {
      id: 'ca',
      title: 'CA 인증서 설치',
      detail:
        '"CA 내보내기(.pem)"로 저장한 파일을 기기로 옮기고 설정 > 보안 > 암호화 및 사용자 인증 정보 > 인증서 설치 > CA 인증서로 설치하세요. (HTTP와 브라우저 위주: Android 7+ 앱은 대부분 사용자 CA를 무시합니다)',
      kind: 'manual',
      evidence: () => ({ done: false })
    },
    trafficStep((i) => wifiClients(i, 'android'), '기기의 Wi-Fi IP'),
    decryptStep((i) => wifiClients(i, 'android'), ANDROID_UNTRUSTED)
  ],
  'ios-wifi': [
    proxyStep,
    {
      id: 'usb-detect',
      title: 'USB로 연결(선택)',
      detail: 'USB로 꽂으면 기기 이름을 목록에서 알아볼 수 있습니다. 가로채기는 항상 Wi-Fi 프록시로 이루어집니다.',
      kind: 'manual',
      evidence: (i) => ({ done: iosDevices(i).length > 0 })
    },
    {
      id: 'lan',
      title: '같은 Wi-Fi에 연결',
      detail: 'iPhone/iPad를 이 PC와 같은 Wi-Fi 네트워크에 연결하세요.',
      kind: 'manual',
      evidence: (i) => (i.proxyAddress && !hasLanIp(i) ? { done: false, blocked: 'PC의 LAN IP를 찾지 못했습니다. Wi-Fi/이더넷 연결을 확인하세요.' } : { done: false })
    },
    {
      id: 'wifi-proxy',
      title: 'Wi-Fi 프록시를 수동으로 설정',
      detail: '설정 > Wi-Fi > (연결된 네트워크) ⓘ > 프록시 구성 > 수동. 서버와 포트를 아래 값으로 입력하세요.',
      kind: 'manual',
      value: (i) => i.proxyAddress,
      evidence: () => ({ done: false })
    },
    {
      id: 'profile',
      title: 'CA 프로파일 내보내기·설치',
      detail: '"CA 프로파일 내보내기"로 저장한 .mobileconfig를 AirDrop/메일로 보내 열고, 설정 > 일반 > VPN 및 기기 관리에서 설치하세요.',
      kind: 'manual',
      evidence: () => ({ done: false })
    },
    {
      id: 'trust',
      title: '인증서 신뢰 설정 켜기',
      detail: '설정 > 일반 > 정보 > 인증서 신뢰 설정에서 EverMock CA를 켜세요. 이 단계 없이는 HTTPS가 복호화되지 않습니다.',
      kind: 'manual',
      evidence: (i) => {
        const found = wifiClients(i, 'ios');
        if (found.some((c) => c.httpsCount > 0)) return { done: true };
        const bad = found.find((c) => clientState(c, i.now) === 'untrusted');
        return bad ? { done: false, blocked: IOS_UNTRUSTED } : { done: false };
      }
    },
    trafficStep((i) => wifiClients(i, 'ios'), '기기'),
    decryptStep((i) => wifiClients(i, 'ios'), IOS_UNTRUSTED)
  ]
};

/** 탭의 단계 정의 개수(테스트/UI용). */
export function stepCount(tab: WizardTab): number {
  return TABS[tab].length;
}

/**
 * 단계별 상태 계산.
 * - 증거가 있는 가장 뒤 단계까지는 모두 done(수동 단계 포함: 뒤가 되면 앞도 된 것). 막힌 단계는 그 앞까지를 done으로 본다.
 * - 그 다음 첫 단계가 current(막힘 사유가 있으면 blocked), 나머지는 pending.
 * - 프록시가 꺼져 있으면 첫 단계(프록시 시작)부터 다시 시작한다.
 */
export function connectionProgress(tab: WizardTab, input: WizardInput): WizardStep[] {
  const defs = TABS[tab];
  const evidences = defs.map((d) => d.evidence(input));
  let lastDone = -1;
  evidences.forEach((e, i) => {
    if (e.done) lastDone = i;
  });
  // 증거가 있는 단계보다 뒤에서 처음 막힌 단계가 있으면, 그 앞 단계까지는 진행된 것이다
  // (예: 신뢰 미설정 → 프로파일 설치까지는 한 것). 더 뒤의 막힘은 같은 원인의 결과이므로 보지 않는다.
  const firstBlocked = evidences.findIndex((e, i) => i > lastDone && !e.done && e.blocked);
  if (firstBlocked > lastDone) lastDone = firstBlocked - 1;

  // 프록시가 꺼져 있으면 무엇이든 첫 단계부터 다시 시작해야 한다(이전 증거는 과거 기록일 뿐).
  if (!input.proxyRunning) lastDone = -1;

  return defs.map((d, i): WizardStep => {
    const base = { id: d.id, title: d.title, detail: d.detail, kind: d.kind, value: d.value?.(input) };
    if (i <= lastDone) return { ...base, status: 'done' };
    if (i === lastDone + 1) {
      const blocked = evidences[i].blocked;
      return blocked ? { ...base, status: 'blocked', reason: blocked } : { ...base, status: 'current' };
    }
    return { ...base, status: 'pending' };
  });
}
