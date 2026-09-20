import type { DeviceInfo, InterceptionResult, SetupStep } from '@shared/device';
import type { DeviceConnector, InterceptionOptions } from '../device-connector';
import type { AdbClient, AdbDevice } from '../adb-client';
import {
  COMPANION_PACKAGE,
  COMPANION_MAIN_ACTIVITY,
  ACTIVATE_ACTION,
  DEACTIVATE_ACTION
} from '@shared/android-vpn';
import { detectRootCommand, setProxy, clearProxy, injectSystemCertificate } from './adb-ops';
import { buildSetupParams, buildConnectUrl } from './vpn-activation';
import type { ApkManager } from './apk-manager';

/** adbkit device type → DeviceInfo status 매핑. */
function mapStatus(type: string): DeviceInfo['status'] {
  if (type === 'device' || type === 'emulator') return 'ready';
  if (type === 'unauthorized') return 'unauthorized';
  if (type === 'offline') return 'offline';
  return 'unknown';
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Android 인터셉션.
 * - root 모드: settings put global http_proxy + 시스템 cacerts remount(root 필요).
 * - vpn 모드: companion VPN 앱 설치 + ACTIVATE 인텐트(non-root 실기기).
 * - auto: root 가능하면 root, 아니면 vpn.
 */
export class AndroidConnector implements DeviceConnector {
  readonly platform = 'android' as const;

  constructor(
    private readonly adb: AdbClient,
    private readonly apkManager?: ApkManager
  ) {}

  async listDevices(): Promise<DeviceInfo[]> {
    let records;
    try {
      records = await this.adb.listDevices();
    } catch {
      // ADB 미설치/실행 불가 등은 빈 목록으로 처리.
      return [];
    }

    return records.map((r) => ({
      id: r.id,
      platform: 'android' as const,
      name: r.id,
      status: mapStatus(r.type)
    }));
  }

  async startInterception(
    deviceId: string,
    options: InterceptionOptions
  ): Promise<InterceptionResult> {
    const device = this.adb.getDevice(deviceId);
    const mode = options.androidMode ?? 'auto';

    // adb reverse: 기기의 proxyPort를 호스트로 터널(에뮬레이터/USB). 실패해도 wifi 폴백.
    let reverseOk = false;
    try {
      await device.reverse(`tcp:${options.proxyPort}`, `tcp:${options.proxyPort}`);
      reverseOk = true;
    } catch {
      reverseOk = false;
    }

    // 방식 결정: vpn 명시 or (auto인데 root 불가)면 VPN.
    if (mode === 'vpn') {
      return this.activateVpn(deviceId, device, options, reverseOk);
    }

    const root = await detectRootCommand(device);
    if (mode === 'auto' && !root) {
      // auto인데 root 불가 → VPN으로 폴백.
      return this.activateVpn(deviceId, device, options, reverseOk);
    }

    return this.activateRoot(deviceId, device, options, root, reverseOk);
  }

  /** root 모드: 프록시 설정 + 시스템 CA 주입. */
  private async activateRoot(
    deviceId: string,
    device: AdbDevice,
    options: InterceptionOptions,
    root: ((cmd: string) => string) | undefined,
    reverseOk: boolean
  ): Promise<InterceptionResult> {
    const warnings: string[] = [];
    if (!reverseOk) {
      warnings.push('adb reverse 터널 설정에 실패했습니다. WiFi 프록시 경로로 시도됩니다.');
    }

    let proxyConfigured = false;
    try {
      await setProxy(device, options.proxyHost, options.proxyPort);
      proxyConfigured = true;
    } catch {
      warnings.push('프록시 설정에 실패했습니다. 기기의 adb 연결을 확인하세요.');
    }

    let caInstalled = false;
    if (options.caPem) {
      if (root) {
        try {
          await injectSystemCertificate(device, root, options.caPem);
          caInstalled = true;
        } catch {
          warnings.push('시스템 CA 주입에 실패했습니다. HTTPS 복호화가 동작하지 않을 수 있습니다.');
        }
      } else {
        warnings.push(
          'root 권한이 없어 시스템 CA를 설치할 수 없습니다. non-root 기기는 VPN 방식을 사용하세요.'
        );
      }
    }

    return { deviceId, proxyConfigured, caInstalled, warnings, usedMode: 'root' };
  }

  /** vpn 모드: companion 앱 설치 + ACTIVATE 인텐트. */
  private async activateVpn(
    deviceId: string,
    device: AdbDevice,
    options: InterceptionOptions,
    reverseOk: boolean
  ): Promise<InterceptionResult> {
    const warnings: string[] = [];

    if (options.proxyRunning === false) {
      // 프록시가 없으면 companion이 신뢰 검증에 실패해 무조건 disconnected가 된다.
      // 인텐트를 보내지 않고 명확한 안내만 반환한다.
      warnings.push(
        '프록시가 실행 중이 아닙니다. 먼저 "프록시 시작"을 누른 뒤 다시 인터셉트하세요. (companion 앱은 프록시 엔드포인트로 신뢰를 검증합니다)'
      );
      return { deviceId, proxyConfigured: false, caInstalled: false, warnings, usedMode: 'vpn' };
    }

    if (!options.certFingerprint) {
      warnings.push('CA 지문이 없어 VPN 앱이 HTTPS를 복호화하지 못할 수 있습니다.');
    }

    // companion APK 설치(없을 때만).
    try {
      const installed = await device.isInstalled(COMPANION_PACKAGE);
      if (!installed) {
        if (!this.apkManager) {
          warnings.push('APK 관리자가 없어 companion 앱을 설치할 수 없습니다.');
          return { deviceId, proxyConfigured: false, caInstalled: false, warnings, usedMode: 'vpn' };
        }
        const apkPath = await this.apkManager.ensureApk();
        try {
          await device.install(apkPath);
        } catch {
          // APK 손상 가능성 → 캐시 비우고 1회 재시도.
          await this.apkManager.clearCache();
          await device.install(await this.apkManager.ensureApk());
        }
        await delay(200); // 인텐트 등록 대기
      }
    } catch {
      warnings.push('companion 앱 설치/확인에 실패했습니다.');
      return { deviceId, proxyConfigured: false, caInstalled: false, warnings, usedMode: 'vpn' };
    }

    // VPN 서비스 시작 이슈 회피: 앱을 포그라운드로.
    try {
      await device.bringToFront(COMPANION_MAIN_ACTIVITY);
    } catch {
      // best-effort
    }

    // 활성화 인텐트.
    const params = buildSetupParams({
      proxyPort: options.proxyPort,
      localTunnelPort: reverseOk ? options.proxyPort : undefined,
      certFingerprint: options.certFingerprint ?? '',
      // 호스트 LAN IP(실기기 wifi 경로). proxyHost가 IP면 후보에 포함.
      reachableIps: options.proxyHost && options.proxyHost !== '127.0.0.1' ? [options.proxyHost] : []
    });

    try {
      await device.startActivity({
        action: ACTIVATE_ACTION,
        data: buildConnectUrl(params)
      });
    } catch {
      warnings.push('VPN 활성화 인텐트 실행에 실패했습니다.');
      return { deviceId, proxyConfigured: false, caInstalled: false, warnings, usedMode: 'vpn' };
    }

    warnings.push('기기 화면에서 VPN 연결 요청을 허용해야 트래픽 캡처가 시작됩니다.');

    // VPN 방식은 프록시 설정을 앱이 담당하고, CA 신뢰는 지문 기반으로 앱이 처리.
    return {
      deviceId,
      proxyConfigured: true,
      caInstalled: !!options.certFingerprint,
      warnings,
      usedMode: 'vpn'
    };
  }

  async stopInterception(deviceId: string): Promise<void> {
    const device = this.adb.getDevice(deviceId);

    // root 모드로 설정된 프록시 해제(best-effort).
    try {
      await clearProxy(device);
    } catch {
      // 무시
    }

    // vpn 모드 해제: 앱 포그라운드 → DEACTIVATE 인텐트(best-effort).
    try {
      await device.bringToFront(COMPANION_MAIN_ACTIVITY);
      await device.startActivity({ action: DEACTIVATE_ACTION, wait: true });
    } catch {
      // companion 앱이 없거나 실패 시 무시.
    }
  }

  getSetupInstructions(): SetupStep[] {
    // Android는 자동이므로 수동 단계 없음.
    return [];
  }
}
