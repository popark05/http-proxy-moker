// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import { Dadb } from '../../../src/main/adb/dadb';
import { AdbException, AdbProtocolException } from '../../../src/main/adb/errors';
import {
  AdbOperationFailedException,
  AdbUnsupportedFeatureException,
  orThrow
} from '../../../src/main/adb/results';
import { localFileMode } from '../../../src/main/adb/services/sync';
import { FakeAndroid } from './fake-android';
import { memoryDevice, tcpDevice, type FakeDevice, type ServiceHandler } from './fake-device';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function memDadb(
  services: ServiceHandler,
  configure?: (device: FakeDevice) => void
): { dadb: Dadb; device: FakeDevice } {
  const { device, transport } = memoryDevice(services);
  configure?.(device);
  const dadb = new Dadb('mem', async () => transport, { keyPair: null });
  cleanups.push(() => dadb.close());
  return { dadb, device };
}

function android(configure?: (device: FakeDevice) => void): { dadb: Dadb; phone: FakeAndroid; device: FakeDevice } {
  const phone = new FakeAndroid();
  return { phone, ...memDadb(phone.services, configure) };
}

async function tmpFile(content: Buffer): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dadb-'));
  cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'file.bin');
  await fs.writeFile(file, content, { mode: 0o640 });
  return file;
}

/** 원시 shell v2 패킷을 보내는 서비스(프로토콜 오류 테스트용). */
function rawShell(packets: Buffer[], closeAfter = true): ServiceHandler {
  return (destination) =>
    destination.startsWith('shell,v2,raw:')
      ? (s) =>
          void (async () => {
            for (const p of packets) await s.send(p);
            if (closeAfter) s.close();
          })()
      : undefined;
}

function shellPacket(id: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header.writeUInt8(id, 0);
  header.writeUInt32LE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

const apk = (size = 4096): Buffer => Buffer.concat([Buffer.from('PK'), crypto.randomBytes(size - 2)]);

describe('shell', () => {
  it('출력/종료 코드', async () => {
    const { dadb } = android();
    const r = await dadb.shell('echo hello');
    expect(r).toEqual({ output: 'hello\n', errorOutput: '', exitCode: 0, allOutput: 'hello\n' });
  });

  it('0이 아닌 종료 코드와 stderr는 예외가 아닌 값', async () => {
    const { dadb } = android();
    const r = await dadb.shell('fail 3 oops');
    expect(r.exitCode).toBe(3);
    expect(r.errorOutput).toBe('oops\n');
    expect(r.allOutput).toBe('oops\n');
  });

  it('255 같은 큰 종료 코드도 부호 없이(dadb는 byte→Int로 음수가 됨)', async () => {
    const { dadb } = android();
    expect((await dadb.shell('fail 255 x')).exitCode).toBe(255);
  });

  // dadb DadbTest.unicode
  it('유니코드 출력', async () => {
    const { dadb } = android();
    expect((await dadb.shell('echo bénéficiaire 한글')).output).toBe('bénéficiaire 한글\n');
  });

  it('멀티바이트 문자가 패킷 경계에서 잘려도 깨지지 않음', async () => {
    const text = Buffer.from('한글', 'utf-8');
    const { dadb } = memDadb(
      rawShell([
        shellPacket(1, text.subarray(0, 2)),
        shellPacket(1, text.subarray(2)),
        shellPacket(3, Buffer.from([0]))
      ])
    );
    expect((await dadb.shell('x')).output).toBe('한글');
  });

  // dadb DadbTest.openShell_write
  it('대화형 셸: stdin 쓰기 → stdout 패킷 → exit', async () => {
    const { dadb } = android();
    const sh = await dadb.openShell();
    await sh.write('echo hello\n');
    const packet = await sh.read();
    expect(packet.type).toBe('stdout');
    expect(packet.type === 'stdout' && packet.payload.toString()).toBe('hello\n');
    await sh.write('exit\n');
    expect(await sh.readAll()).toMatchObject({ output: '', exitCode: 0 });
    await sh.close();
  });

  it('closeStdin은 셸을 종료시킴', async () => {
    const { dadb } = android();
    const sh = await dadb.openShell();
    await sh.closeStdin();
    expect((await sh.readAll()).exitCode).toBe(0);
  });

  // dadb DadbTest.openShell_concurrency
  it('동시에 20개 대화형 셸', async () => {
    const { dadb } = android();
    await Promise.all(
      Array.from({ length: 20 }, async (_, i) => {
        const token = `r${i}-${Math.random()}`;
        const sh = await dadb.openShell();
        await sh.write(`echo ${token}\n`);
        const packet = await sh.read();
        expect(packet.type === 'stdout' && packet.payload.toString()).toBe(`${token}\n`);
        await sh.write('exit\n');
        expect((await sh.readAll()).exitCode).toBe(0);
        await sh.close();
      })
    );
  });

  it('잘못된 패킷 id는 AdbProtocolException', async () => {
    const { dadb } = memDadb(rawShell([shellPacket(9, Buffer.from('x'))]));
    await expect(dadb.shell('x')).rejects.toBeInstanceOf(AdbProtocolException);
  });

  it('exit 패킷 길이가 1이 아니면 AdbProtocolException', async () => {
    const { dadb } = memDadb(rawShell([shellPacket(3, Buffer.from([0, 0]))]));
    await expect(dadb.shell('x')).rejects.toBeInstanceOf(AdbProtocolException);
  });

  it('exit 없이 스트림이 끝나면 AdbProtocolException', async () => {
    const { dadb } = memDadb(rawShell([shellPacket(1, Buffer.from('partial'))]));
    await expect(dadb.shell('x')).rejects.toBeInstanceOf(AdbProtocolException);
  });

  it('shell_v2 미지원 기기는 AdbUnsupportedFeatureException', async () => {
    const { dadb } = android((d) => (d.banner = 'device::features=cmd\0'));
    await expect(dadb.shell('echo x')).rejects.toBeInstanceOf(AdbUnsupportedFeatureException);
  });
});

describe('push / pull', () => {
  // dadb DadbTest.adbPush_basic / DadbResultTest.pushSuccessReturnsSyncSuccess
  it('바이트 push → pull 왕복, mode/mtime 전달', async () => {
    const { dadb, phone } = android();
    const content = Buffer.from(`hello ${Math.random()}`);
    expect(await dadb.push(content, '/data/local/tmp/hello', 0o644, 1_700_000_000_123)).toEqual({
      success: true
    });
    expect(phone.files.get('/data/local/tmp/hello')).toEqual({
      data: content,
      mode: 0o644,
      mtimeSec: 1_700_000_000
    });

    const chunks: Buffer[] = [];
    expect(await dadb.pull((c) => void chunks.push(c), '/data/local/tmp/hello')).toEqual({ success: true });
    expect(Buffer.concat(chunks)).toEqual(content);
  });

  it('큰 파일(3MB)은 64KB 이하 DATA로 나눠 보내고 그대로 받음', async () => {
    const { dadb, phone } = android();
    const content = crypto.randomBytes(3 * 1024 * 1024 + 17);
    expect((await dadb.push(content, '/data/local/tmp/big')).success).toBe(true);
    expect(phone.files.get('/data/local/tmp/big')!.data.equals(content)).toBe(true);

    const chunks: Buffer[] = [];
    await dadb.pull((c) => void chunks.push(c), '/data/local/tmp/big');
    expect(Buffer.concat(chunks).equals(content)).toBe(true);
  });

  it('Readable 스트림 push', async () => {
    const { dadb, phone } = android();
    await dadb.push(Readable.from([Buffer.from('ab'), Buffer.from('cd')]), '/data/local/tmp/s');
    expect(phone.files.get('/data/local/tmp/s')!.data.toString()).toBe('abcd');
  });

  // dadb DadbTest.adbPush_pathWithCJK
  it('CJK 경로', async () => {
    const { dadb, phone } = android();
    await dadb.push(Buffer.from('x'), '/data/local/tmp/你好こんにちは');
    expect(phone.files.has('/data/local/tmp/你好こんにちは')).toBe(true);
  });

  // dadb DadbTest.adbPush_file
  it('파일 경로 push(파일 권한 사용) → 파일 경로 pull', async () => {
    const { dadb, phone } = android();
    const content = crypto.randomBytes(100_000);
    const src = await tmpFile(content);
    expect((await dadb.push(src, '/data/local/tmp/f')).success).toBe(true);
    // Windows는 Unix 권한이 없어 기본값(0o644)을 보낸다(localFileMode 테스트 참고).
    expect(phone.files.get('/data/local/tmp/f')!.mode & 0o777).toBe(process.platform === 'win32' ? 0o644 : 0o640);

    const dst = path.join(path.dirname(src), 'pulled.bin');
    expect((await dadb.pull(dst, '/data/local/tmp/f')).success).toBe(true);
    expect((await fs.readFile(dst)).equals(content)).toBe(true);
  });

  it('localFileMode: Windows는 stat.mode(0o666/0o444) 대신 0o644, 그 외는 파일 권한 그대로', () => {
    expect(localFileMode(0o100666, 'win32')).toBe(0o644);
    expect(localFileMode(0o100444, 'win32')).toBe(0o644);
    expect(localFileMode(0o100640, 'darwin')).toBe(0o100640);
  });

  // dadb DadbResultTest.pullMissingFileReturnsSyncFailure
  it('없는 파일 pull은 SyncResult 실패(예외 아님), 만들다 만 로컬 파일은 삭제', async () => {
    const { dadb } = android();
    const dst = path.join(path.dirname(await tmpFile(Buffer.alloc(0))), 'missing.bin');
    expect(await dadb.pull(dst, '/missing')).toEqual({
      success: false,
      reason: 'No such file or directory'
    });
    await expect(fs.access(dst)).rejects.toThrow();
  });

  it('기기가 거부한 push는 SyncResult 실패', async () => {
    const { dadb } = android();
    expect(await dadb.push(Buffer.from('x'), '/readonly/x')).toEqual({
      success: false,
      reason: 'Permission denied'
    });
  });

  // dadb DadbResultTest.syncRecvUnexpectedPacketThrowsProtocolException
  it('예상 밖 sync 패킷은 AdbProtocolException', async () => {
    const { dadb } = memDadb((d) =>
      d === 'sync:'
        ? (s) =>
            void (async () => {
              await s.readBytes(8);
              const okay = Buffer.alloc(8);
              okay.write('OKAY', 0, 4, 'ascii');
              await s.send(okay);
            })()
        : undefined
    );
    await expect(dadb.pull(() => {}, '/somewhere')).rejects.toBeInstanceOf(AdbProtocolException);
  });

  it('작업 후 sync 스트림을 QUIT으로 닫음', async () => {
    const { dadb, device } = android();
    await dadb.push(Buffer.from('x'), '/data/local/tmp/q');
    await new Promise((r) => setTimeout(r, 10));
    expect(device.streams.size).toBe(0);
  });
});

describe('install / uninstall', () => {
  // dadb DadbResultTest.installCmdPathSuccessReturnsSuccess
  it('cmd 경로: APK 바이트를 exec:cmd로 스트리밍, 옵션 전달', async () => {
    const { dadb, phone } = android();
    const bytes = apk(300_000);
    expect(await dadb.install(bytes, '-r', '-g')).toEqual({ success: true });
    expect(phone.installs).toEqual([{ size: bytes.length, options: ['-r', '-g'] }]);
    expect(phone.packages.has('com.example.app')).toBe(true);
  });

  it('파일 경로 설치', async () => {
    const { dadb, phone } = android();
    expect((await dadb.install(await tmpFile(apk()))).success).toBe(true);
    expect(phone.packages.has('com.example.app')).toBe(true);
  });

  // dadb DadbResultTest.installCmdPathFailureReturnsInstallFailure
  it('설치 거부는 InstallResult 실패(응답 원문)', async () => {
    const { dadb } = android();
    const result = await dadb.install(Buffer.from('not an apk'));
    expect(result.success).toBe(false);
    expect(!result.success && result.reason).toContain('INSTALL_FAILED_INVALID_APK');
  });

  it('pm이 끝까지 읽기 전에 거부하고 닫아도 응답을 돌려줌', async () => {
    const { dadb, phone } = android();
    phone.rejectInstallEarly = true;
    const result = await dadb.install(apk(2 * 1024 * 1024));
    expect(!result.success && result.reason).toContain('early');
  });

  it('cmd 미지원 기기: push → pm install → 임시 파일 삭제', async () => {
    const { dadb, phone } = android((d) => (d.banner = 'device::features=shell_v2\0'));
    expect((await dadb.install(apk(), '-r')).success).toBe(true);
    expect(phone.packages.has('com.example.app')).toBe(true);
    expect(phone.shellCommands.some((c) => /^pm install -r "\/data\/local\/tmp\/dadb-\w+\.apk"$/.test(c))).toBe(
      true
    );
    expect(phone.files.size).toBe(0);
  });

  // dadb DadbTest.installMultiple
  it('split APK 설치(세션 create → write → commit)', async () => {
    const { dadb, phone } = android();
    const files = [await tmpFile(apk()), await tmpFile(apk())];
    expect(await dadb.installMultiple(files)).toEqual({ success: true });
    expect(phone.packages.has('com.example.split:2')).toBe(true);
  });

  // dadb DadbResultTest.uninstall*
  it('제거 성공/실패(종료 코드 포함)', async () => {
    const { dadb, phone } = android();
    phone.packages.add('com.example');
    expect(await dadb.uninstall('com.example')).toEqual({ success: true });
    const failed = await dadb.uninstall('com.example.absent');
    expect(failed).toMatchObject({ success: false, exitCode: 1 });
    expect(!failed.success && failed.reason).toContain('DELETE_FAILED_INTERNAL_ERROR');
  });

  it('execCmd는 cmd 미지원 기기에서 AdbUnsupportedFeatureException', async () => {
    const { dadb } = android((d) => (d.banner = 'device::features=shell_v2\0'));
    await expect(dadb.execCmd('package', 'list')).rejects.toBeInstanceOf(AdbUnsupportedFeatureException);
  });
});

// dadb ResultHelpersTest
describe('orThrow', () => {
  it('성공이면 아무것도 안 함', () => {
    expect(() => orThrow({ success: true })).not.toThrow();
  });

  it('실패면 AdbOperationFailedException(AdbException 아님)', () => {
    let thrown: unknown;
    try {
      orThrow({ success: false, reason: 'Failure [INSTALL_FAILED_INVALID_APK]' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AdbOperationFailedException);
    expect(thrown).not.toBeInstanceOf(AdbException);
    expect((thrown as AdbOperationFailedException).reason).toContain('INSTALL_FAILED');
  });

  it('uninstall 실패는 종료 코드를 담음', () => {
    try {
      orThrow({ success: false, reason: 'x', exitCode: 1 });
    } catch (e) {
      expect((e as AdbOperationFailedException).exitCode).toBe(1);
    }
  });
});

describe('root', () => {
  // dadb DadbResultTest.rootFailureReturnsRootFailure
  it('production 빌드의 거부는 RootResult 실패', async () => {
    const { dadb } = android();
    const result = await dadb.root();
    expect(!result.success && result.reason).toContain('production builds');
  });

  it('adbd 재시작(연결 끊김) 후 재연결해 root 상태를 확인', async () => {
    const phone = new FakeAndroid();
    phone.rootResponse = 'restarting adbd as root\n';
    const server = await tcpDevice(phone.services);
    cleanups.push(() => server.close());
    phone.onAdbdRestart = () => setTimeout(() => server.sockets.forEach((s) => s.destroy()), 5);

    const dadb = Dadb.create('127.0.0.1', server.port, { keyPair: null });
    cleanups.push(() => dadb.close());
    expect(await dadb.root({ intervalMs: 20 })).toEqual({ success: true });
    expect((await dadb.shell('getprop service.adb.root')).output).toBe('1\n');
    expect(server.devices.length).toBeGreaterThan(1);
  });
});

describe('tcpForward', () => {
  async function exchange(port: number, text: string): Promise<string> {
    const socket = net.connect(port, '127.0.0.1');
    const chunks: Buffer[] = [];
    socket.on('data', (c) => chunks.push(c));
    socket.write(text);
    await new Promise((r) => setTimeout(r, 50));
    socket.end();
    await new Promise((r) => socket.on('close', r));
    return Buffer.concat(chunks).toString();
  }

  // dadb DadbTest.tcpForward_singleConnection / multipleSequentialConnections
  it('호스트 포트 → 기기 tcp: 스트림 양방향 중계(연속 연결)', async () => {
    const { dadb, device } = android();
    const tunnel = await dadb.tcpForward(0, 7000);
    cleanups.push(() => tunnel.close());

    expect(await exchange(tunnel.port, 'hello')).toBe('HELLO');
    expect(await exchange(tunnel.port, 'again')).toBe('AGAIN');
    const opened = device.received.filter((m) => m.payload.toString() === 'tcp:7000\0');
    expect(opened.length).toBe(2);
  });

  it('close 후에는 포트가 닫힘', async () => {
    const { dadb } = android();
    const tunnel = await dadb.tcpForward(0, 7000);
    await tunnel.close();
    const error = await new Promise<Error>((resolve) => {
      const s = net.connect(tunnel.port, '127.0.0.1');
      s.on('error', resolve);
    });
    expect((error as NodeJS.ErrnoException).code).toBe('ECONNREFUSED');
  });
});
