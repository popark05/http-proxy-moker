import type {
  AndroidInterceptionMode,
  DeviceInfo,
  DevicePlatform,
  InterceptionResult,
  SetupStep
} from '@shared/device';
import type { DeviceConnector, InterceptionOptions } from './device-connector';

/**
 * 여러 플랫폼 커넥터를 묶어 기기 목록/인터셉션을 조율한다.
 * 인터셉션 옵션(프록시 host/port, CA)은 provider로 지연 조회한다(프록시 상태에 따라 달라짐).
 */
export class DeviceService {
  private readonly connectors = new Map<DevicePlatform, DeviceConnector>();

  constructor(
    private readonly getOptions: () => Promise<InterceptionOptions>
  ) {}

  register(connector: DeviceConnector): void {
    this.connectors.set(connector.platform, connector);
  }

  private connectorFor(platform: DevicePlatform): DeviceConnector {
    const connector = this.connectors.get(platform);
    if (!connector) throw new Error(`No connector for platform ${platform}`);
    return connector;
  }

  async listDevices(): Promise<DeviceInfo[]> {
    const all = await Promise.all(
      [...this.connectors.values()].map((c) => c.listDevices().catch(() => []))
    );
    return all.flat();
  }

  async startInterception(
    platform: DevicePlatform,
    deviceId: string,
    androidMode?: AndroidInterceptionMode
  ): Promise<InterceptionResult> {
    const options = await this.getOptions();
    const connector = this.connectorFor(platform);
    return connector.startInterception(deviceId, { ...options, androidMode });
  }

  async stopInterception(platform: DevicePlatform, deviceId: string): Promise<void> {
    const connector = this.connectorFor(platform);
    await connector.stopInterception(deviceId);
  }

  async getSetupInstructions(platform: DevicePlatform): Promise<SetupStep[]> {
    const connector = this.connectors.get(platform);
    if (!connector) return [];
    const options = await this.getOptions();
    return connector.getSetupInstructions(options);
  }
}
