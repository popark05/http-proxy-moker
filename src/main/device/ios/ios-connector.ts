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

  getSetupInstructions(options: InterceptionOptions): SetupStep[] {
    const proxyValue = `${options.proxyHost}:${options.proxyPort}`;
    return [
      {
        title: '1. 같은 WiFi에 연결',
        detail: 'iPhone/iPad를 이 맥과 동일한 WiFi 네트워크에 연결하세요.'
      },
      {
        title: '2. WiFi 프록시 수동 설정',
        detail:
          '설정 > Wi-Fi > (연결된 네트워크) > 프록시 구성 > 수동. 서버와 포트를 아래 값으로 입력하세요.',
        value: proxyValue
      },
      {
        title: '3. CA 프로파일 설치',
        detail:
          'CA 내보내기에서 .mobileconfig를 받아 기기로 전송(AirDrop/이메일)한 뒤 설정에서 프로파일을 설치하세요.'
      },
      {
        title: '4. 인증서 신뢰 활성화',
        detail:
          '설정 > 일반 > 정보 > 인증서 신뢰 설정에서 EverMock CA의 신뢰를 활성화하세요. (이 단계 없이는 HTTPS가 복호화되지 않습니다)'
      }
    ];
  }
}
