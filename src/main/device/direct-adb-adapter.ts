import { Dadb, type DadbListOptions } from '../adb/dadb';
import type { UsbBackend } from '../adb/transport/usb-discovery';
import { AdbAuthException, AdbUsbAccessException } from '../adb/errors';
import { orThrow } from '../adb/results';
import type { AdbClient, AdbDevice, AdbDeviceRecord } from './adb-client';

/** 첫 목록 응답에서 연결 판정을 기다리는 시간. 넘으면 사용자 승인 대기(unauthorized)로 표시한다. */
const FIRST_PROBE_WAIT_MS = 1_500;
/** "USB 디버깅 허용" 승인을 기다리는 시간(연결 시도 1회). 실패하면 다음 목록 갱신에서 다시 시도한다. */
const AUTH_TIMEOUT_MS = 15_000;

export interface DirectAdbOptions {
  /** Dadb 옵션(테스트에서 가짜 키/타임아웃을 줄 때). */
  dadb?: DadbListOptions;
  /** USB 백엔드(테스트용). */
  usbBackend?: UsbBackend;
}

type DeviceState = 'device' | 'unauthorized' | 'offline';

interface Entry {
  dadb: Dadb;
  state: DeviceState;
  /** offline/unauthorized일 때 사용자에게 보여줄 원인. */
  detail?: string;
  /** 진행 중인 연결 시도(중복 시도 방지). */
  probe?: Promise<void>;
}

/** 셸 인자 하나를 작은따옴표로 감싼다. */
function quote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * adb 바이너리/adb server 없이 `src/main/adb`(직접 USB/TCP 통신)로 구현한 AdbClient.
 *
 * Dadb 인스턴스를 시리얼별로 캐시한다: 연결과 reverse 규칙이 인스턴스에 묶여 있고
 * (끊기면 다음 작업에서 자동 재연결 + 규칙 재설치), 목록 갱신(5초 주기)마다 새로 만들면 둘 다 잃는다.
 */
export function createDirectAdbClient(options: DirectAdbOptions = {}): AdbClient & {
  /** 캐시한 연결을 모두 닫는다(앱 종료 시). */
  close(): Promise<void>;
} {
  const entries = new Map<string, Entry>();
  const dadbOptions: DadbListOptions = { authTimeoutMs: AUTH_TIMEOUT_MS, ...options.dadb };

  function classify(entry: Entry, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof AdbAuthException) {
      entry.state = 'unauthorized';
      entry.detail = '기기 화면에서 "USB 디버깅 허용"을 승인하세요.';
    } else {
      entry.state = 'offline';
      entry.detail = error instanceof AdbUsbAccessException ? message : `연결 실패: ${message}`;
    }
  }

  /** 연결 시도를 시작한다(이미 진행 중이면 그 시도를 반환). */
  function probe(entry: Entry): Promise<void> {
    if (!entry.probe) {
      entry.probe = entry.dadb
        .connect()
        .then(() => {
          entry.state = 'device';
          entry.detail = undefined;
        })
        .catch((e) => classify(entry, e))
        .finally(() => {
          entry.probe = undefined;
        });
    }
    return entry.probe;
  }

  function entryFor(serial: string, dadb?: Dadb): Entry {
    let entry = entries.get(serial);
    if (!entry) {
      const emulator = /^emulator-(\d+)$/.exec(serial);
      const created =
        dadb ??
        (emulator
          ? Dadb.fromEmulator(Number(emulator[1]) + 1, dadbOptions)
          : Dadb.fromUsb(serial, { ...dadbOptions, usbBackend: options.usbBackend }));
      // 첫 판정 전에는 승인 대기로 본다(실제로는 곧 연결 결과로 갱신된다).
      entry = { dadb: created, state: 'unauthorized' };
      entries.set(serial, entry);
    }
    return entry;
  }

  return {
    async listDevices(): Promise<AdbDeviceRecord[]> {
      const found = await Dadb.list({ ...dadbOptions, usbBackend: options.usbBackend });
      const serials = new Set(found.map((d) => d.serial));

      // 사라진 기기의 연결은 정리한다.
      for (const [serial, entry] of entries) {
        if (!serials.has(serial)) {
          entries.delete(serial);
          void entry.dadb.close();
        }
      }
      for (const dadb of found) entryFor(dadb.serial, dadb);

      const pending: Promise<void>[] = [];
      for (const entry of entries.values()) {
        if (entry.dadb.connectionKind) {
          entry.state = 'device';
          entry.detail = undefined;
        } else {
          pending.push(probe(entry));
        }
      }
      // 빠르게 끝나는 연결(이미 승인된 기기)은 이번 응답에 반영하고, 승인 대기는 기다리지 않는다.
      await Promise.race([
        Promise.allSettled(pending),
        new Promise((r) => setTimeout(r, FIRST_PROBE_WAIT_MS))
      ]);

      return [...entries.entries()].map(([id, entry]) => ({
        id,
        type: id.startsWith('emulator-') && entry.state === 'device' ? 'emulator' : entry.state,
        detail: entry.detail
      }));
    },

    getDevice(id: string): AdbDevice {
      const { dadb } = entryFor(id);
      return {
        async shell(command) {
          const text = Array.isArray(command) ? command.map(quote).join(' ') : command;
          return (await dadb.shell(text)).allOutput;
        },
        async pushContent(content, remotePath) {
          orThrow(await dadb.push(Buffer.from(content, 'utf-8'), remotePath));
        },
        async reverse(remote, local) {
          await dadb.reverse(remote, local);
        },
        async removeReverse(remote) {
          await dadb.killReverse(remote);
        },
        async isInstalled(pkg) {
          const out = (await dadb.shell(`pm path ${quote(pkg)}`)).output;
          return out.includes('package:');
        },
        async install(apkPath) {
          orThrow(await dadb.install(apkPath, '-r'));
        },
        async startActivity({ action, data, wait }) {
          const args = ['am', 'start'];
          if (wait) args.push('-W');
          args.push('-a', quote(action));
          if (data) args.push('-d', quote(data));
          await runAm(args.join(' '));
        },
        async bringToFront(component) {
          await runAm(`am start -n ${quote(component)}`);
        }
      };

      /** am은 실패해도 종료 코드 0으로 "Error: ..."만 출력하는 경우가 있어 출력으로 판정한다. */
      async function runAm(command: string): Promise<void> {
        const out = (await dadb.shell(command)).allOutput;
        const error = /^Error.*$/m.exec(out);
        if (error) throw new Error(`액티비티 실행 실패: ${error[0]}`);
      }
    },

    async close(): Promise<void> {
      const all = [...entries.values()];
      entries.clear();
      await Promise.allSettled(all.map((e) => e.dadb.close()));
    }
  };
}
