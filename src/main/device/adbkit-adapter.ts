import * as path from 'node:path';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import type { AdbClient, AdbDevice, AdbDeviceRecord } from './adb-client';

// adbkit은 CommonJS 모듈이라 ESM named export가 불가하고, default interop도
// 번들러에 따라 흔들린다. createRequire로 CJS를 직접 로드해 Adb.createClient를 얻는다.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const adbkit = require('@devicefarmer/adbkit') as {
  Adb: { createClient(opts: { port: number; bin: string }): AdbkitClient };
};
const Adb = adbkit.Adb;

/** adbkit client의 최소 표면(우리가 쓰는 것만). */
interface AdbkitClient {
  on(event: 'error', cb: (e: unknown) => void): void;
  listDevices(): Promise<Array<{ id: string; type: string }>>;
  getDevice(id: string): AdbkitDeviceClient;
}

interface AdbkitDeviceClient {
  shell(command: string | string[]): Promise<NodeJS.ReadableStream>;
  push(stream: NodeJS.ReadableStream, remotePath: string): Promise<AdbkitTransfer>;
  reverse(remote: string, local: string): Promise<boolean>;
  isInstalled(pkg: string): Promise<boolean>;
  install(apk: string | NodeJS.ReadableStream): Promise<boolean>;
  startActivity(options: {
    action?: string;
    data?: string;
    component?: string;
    wait?: boolean;
  }): Promise<boolean>;
}

interface AdbkitTransfer {
  on(event: 'end' | 'error', cb: (arg?: unknown) => void): void;
}

/** adbkit 유틸: 스트림을 문자열로 수집. */
function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    stream.on('error', reject);
  });
}

/**
 * 실제 @devicefarmer/adbkit 기반 AdbClient 구현.
 * ANDROID_HOME/platform-tools/adb 또는 PATH의 adb를 사용.
 */
export function createAdbkitClient(): AdbClient {
  const client = Adb.createClient({
    port: process.env.ANDROID_ADB_SERVER_PORT
      ? parseInt(process.env.ANDROID_ADB_SERVER_PORT, 10)
      : 5037,
    bin: process.env.ANDROID_HOME
      ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb')
      : 'adb'
  });

  // adbkit 내부 연결 오류가 미처리되어 크래시하지 않도록 흡수.
  client.on('error', () => {});

  return {
    async listDevices(): Promise<AdbDeviceRecord[]> {
      const devices = await client.listDevices();
      return devices.map((d: { id: string; type: string }) => ({ id: d.id, type: d.type }));
    },

    getDevice(id: string): AdbDevice {
      const device = client.getDevice(id);
      return {
        async shell(command) {
          const stream = await device.shell(command);
          return streamToString(stream);
        },
        async pushContent(content, remotePath) {
          const transfer = await device.push(Readable.from(content), remotePath);
          await new Promise<void>((resolve, reject) => {
            transfer.on('end', () => resolve());
            transfer.on('error', reject);
          });
        },
        async reverse(remote, local) {
          await device.reverse(remote, local);
        },
        async removeReverse() {
          // adbkit은 개별 reverse 제거 API를 제공하지 않는다.
          // 인터셉션 해제 시 프록시 설정만 해제해도 캡처는 중단되므로 no-op으로 둔다.
        },
        async isInstalled(pkg) {
          return device.isInstalled(pkg);
        },
        async install(apkPath) {
          await device.install(apkPath);
        },
        async startActivity(options) {
          await device.startActivity(options);
        },
        async bringToFront(component) {
          await device.startActivity({ component, wait: false });
        }
      };
    }
  };
}
