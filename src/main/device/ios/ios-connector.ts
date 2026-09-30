import type { DeviceInfo, InterceptionResult, SetupStep } from '@shared/device';
import type { DeviceConnector, InterceptionOptions } from '../device-connector';
import type { UsbmuxClientLike, UsbmuxDeviceValues } from '../usbmux-client';

/**
 * iOS 반자동 연동(Phase 1).
 * - 감지: usbmux로 USB 연결 기기 목록/이름 표시.
 * - 인터셉션: 자동화 불가. WiFi 프록시 수동 설정 + CA 프로파일 설치를 안내한다.
 * - Frida 기반 자동 인터셉션은 Phase 3.
 *
 * usbmux가 미연결(WiFi만)이어도 수동 셋업 가이드는 항상 제공된다.
 */
export class IosConnector implements DeviceConnector {
  readonly platform = 'ios' as const;

  constructor(private readonly usbmux: UsbmuxClientLike) {}

  async listDevices(): Promise<DeviceInfo[]> {
    let devices: Record<string, { DeviceID: number }>;
    try {
      devices = await this.usbmux.getDevices();
    } catch {
      return [];
    }

    const records = Object.values(devices);
    const infos = await Promise.all(
      records.map(async (record): Promise<DeviceInfo> => {
        const values: UsbmuxDeviceValues = await this.usbmux
          .queryAllDeviceValues(record.DeviceID)
          .catch(() => ({}));
        const udid = values.UniqueDeviceID ?? String(record.DeviceID);
        const name = values.DeviceName ?? values.DeviceClass ?? 'iOS 기기';
        return {
          id: udid,
          platform: 'ios',
          name,
          status: 'ready'
        };
      })
    );
    return infos;
  }

  /**
   * iOS는 자동 인터셉션이 불가하므로, 시작 요청 시 프록시/CA를 자동 설정하지 않고
   * 수동 셋업이 필요함을 경고로 알린다(실제 단계는 getSetupInstructions).
   */
  async startInterception(deviceId: string): Promise<InterceptionResult> {
    return {
      deviceId,
      proxyConfigured: false,
      caInstalled: false,
      warnings: [
        'iOS는 자동 설정을 지원하지 않습니다. 셋업 가이드에 따라 WiFi 프록시와 CA 프로파일을 수동으로 설치하세요.'
      ]
    };
  }

  async stopInterception(): Promise<void> {
    // iOS는 프록시를 자동 해제할 수 없다. 사용자가 기기에서 직접 해제해야 함.
  }

  /** 번호는 화면에서 순서대로 붙인다. 각 단계에 수행 위치(pc/device)를 명시한다. */
  getSetupInstructions(options: InterceptionOptions): SetupStep[] {
    const proxyValue = `${options.proxyHost}:${options.proxyPort}`;
    const winNote: SetupStep[] =
      process.platform === 'win32'
        ? [
            {
              where: 'pc',
              title: 'Apple 기기 드라이버 설치',
              detail:
                'iPhone/iPad를 USB로 감지하려면 Apple Mobile Device Service가 필요합니다. iTunes 또는 Apple Devices 앱(Microsoft Store)을 설치하세요.'
            }
          ]
        : [];
    return [
      ...winNote,
      {
        where: 'device',
        title: '같은 WiFi에 연결',
        detail: 'iPhone/iPad를 이 컴퓨터와 동일한 WiFi 네트워크에 연결하세요.'
      },
      {
        where: 'device',
        title: 'WiFi 프록시를 수동으로 설정',
        detail:
          '설정 > Wi-Fi > (연결된 네트워크) ⓘ > 프록시 구성 > 수동. 서버와 포트를 아래 값으로 입력하세요.',
        value: proxyValue
      },
      {
        where: 'pc',
        action: 'exportCa',
        title: 'CA 프로파일을 내보내 기기로 전송',
        detail:
          '아래 버튼으로 .mobileconfig 파일을 저장한 뒤 AirDrop이나 이메일로 iPhone/iPad에 보내세요.'
      },
      {
        where: 'device',
        title: 'CA 프로파일 설치',
        detail: '받은 파일을 열고 설정 > 일반 > VPN 및 기기 관리(프로파일)에서 설치하세요.'
      },
      {
        where: 'device',
        title: '인증서 신뢰 활성화',
        detail:
          '설정 > 일반 > 정보 > 인증서 신뢰 설정에서 EverMock CA의 신뢰를 활성화하세요. (이 단계 없이는 HTTPS가 복호화되지 않습니다)'
      }
    ];
  }
}
