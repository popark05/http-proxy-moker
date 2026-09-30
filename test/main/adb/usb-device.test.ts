// @vitest-environment node
/**
 * B-7 실기기 검증: USB로 연결한 Android 기기와 adb server 없이 직접 통신한다.
 *
 * 준비
 *  1. 기기에서 개발자 옵션 > USB 디버깅 켜기, USB 케이블 연결
 *  2. adb server 종료(인터페이스를 점유함):  adb kill-server
 *  3. 실행(시리얼 지정 또는 1 = 첫 번째 USB 기기):
 *       ADB_TEST_USB=1 npx vitest run test/main/adb/usb-device.test.ts
 *     처음 보는 키면 기기에 "USB 디버깅을 허용하시겠습니까?"가 뜬다 → 60초 안에 허용.
 *     (~/.android/adbkey를 adb와 공유하므로 adb로 이미 허용한 Mac이면 팝업 없음)
 *
 * 선택: 설치/제거 검증
 *     ADB_TEST_APK=/path/app.apk ADB_TEST_APK_PACKAGE=com.example.app
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as crypto from 'node:crypto';
import * as net from 'node:net';
import { Dadb } from '../../../src/main/adb/dadb';
import type { AdbConnection } from '../../../src/main/adb/protocol/connection';
import { listUsbAdbDevices } from '../../../src/main/adb/transport/usb-discovery';

const target = process.env.ADB_TEST_USB;
const REMOTE_DIR = '/data/local/tmp';
const AUTH_TIMEOUT = 60_000;

let dadb: Dadb;
let serial: string;

/** adb server(5037)가 떠 있으면 USB 인터페이스를 점유하고 있으므로 먼저 알려 준다. */
function adbServerRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(5037, '127.0.0.1');
    socket.setTimeout(300, () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

function log(message: string): void {
  console.log(`[usb-device] ${message}`);
}

describe.skipIf(!target)('USB 실기기 (adb server 없이)', () => {
  beforeAll(async () => {
    if (await adbServerRunning()) {
      // 앱은 이 경우 adb server 경유로 대체하지만, 이 테스트는 직접 USB 경로를 검증한다.
      throw new Error('adb server가 실행 중입니다(127.0.0.1:5037). `adb kill-server` 후 다시 실행하세요.');
    }
    const devices = await listUsbAdbDevices();
    log(`USB ADB 기기: ${devices.map((d) => `${d.serial} (${d.manufacturerName ?? ''} ${d.productName ?? ''})`).join(', ') || '없음'}`);
    const picked = target === '1' ? devices[0] : devices.find((d) => d.serial === target);
    if (!picked) throw new Error(`USB ADB 기기를 찾지 못했습니다(ADB_TEST_USB=${target}). USB 디버깅/케이블을 확인하세요.`);
    serial = picked.serial;

    dadb = Dadb.fromUsb(serial, { authTimeoutMs: AUTH_TIMEOUT, readTimeoutMs: 30_000, adbServerFallback: false });
    log('연결 중... (처음이면 기기 화면에서 USB 디버깅 허용)');
    const started = Date.now();
    const connection = (await dadb.connect()) as AdbConnection;
    expect(connection.kind).toBe('direct');
    log(
      `연결됨 ${Date.now() - started}ms: state=${connection.banner.state} ` +
        `model=${connection.banner.properties['ro.product.model']} maxPayload=${connection.maxPayloadSize}`
    );
  }, AUTH_TIMEOUT + 15_000);

  afterAll(async () => {
    await dadb?.shell(`rm -f ${REMOTE_DIR}/dadb-ts-*`).catch(() => undefined);
    await dadb?.close();
  });

  it('핸드셰이크: 배너와 주요 기능', async () => {
    const connection = (await dadb.connect()) as AdbConnection;
    expect(connection.banner.state).toBe('device');
    for (const feature of ['shell_v2', 'cmd']) {
      expect(connection.supportsFeature(feature), `feature ${feature}`).toBe(true);
    }
  });

  it('shell v2: stdout/stderr/종료 코드/유니코드', async () => {
    const r = await dadb.shell('echo bénéficiaire 한글; echo err >&2; exit 3');
    expect(r).toMatchObject({ output: 'bénéficiaire 한글\n', errorOutput: 'err\n', exitCode: 3 });

    const model = (await dadb.shell('getprop ro.product.model')).output.trim();
    const sdk = (await dadb.shell('getprop ro.build.version.sdk')).output.trim();
    log(`model=${model} sdk=${sdk}`);
    expect(model.length).toBeGreaterThan(0);
  });

  it('대화형 셸과 동시 셸 10개', async () => {
    const sh = await dadb.openShell();
    await sh.write('echo interactive\n');
    const packet = await sh.read();
    expect(packet.type === 'stdout' && packet.payload.toString()).toBe('interactive\n');
    await sh.write('exit\n');
    expect((await sh.readAll()).exitCode).toBe(0);
    await sh.close();

    const outputs = await Promise.all(
      Array.from({ length: 10 }, (_, i) => dadb.shell(`echo c${i}`).then((r) => r.output))
    );
    expect(outputs).toEqual(Array.from({ length: 10 }, (_, i) => `c${i}\n`));
  });

  it('push/pull 8MB 왕복(무결성 + 속도)', async () => {
    const content = crypto.randomBytes(8 * 1024 * 1024 + 321);
    const remote = `${REMOTE_DIR}/dadb-ts-big`;

    let started = Date.now();
    expect(await dadb.push(content, remote)).toEqual({ success: true });
    const pushMs = Date.now() - started;

    started = Date.now();
    const chunks: Buffer[] = [];
    expect(await dadb.pull((c) => void chunks.push(c), remote)).toEqual({ success: true });
    const pullMs = Date.now() - started;

    expect(Buffer.concat(chunks).equals(content)).toBe(true);
    const mb = content.length / 1024 / 1024;
    log(`push ${(mb / (pushMs / 1000)).toFixed(1)} MB/s, pull ${(mb / (pullMs / 1000)).toFixed(1)} MB/s`);

    const sha = (await dadb.shell(`sha256sum ${remote}`)).output.split(/\s+/)[0];
    expect(sha).toBe(crypto.createHash('sha256').update(content).digest('hex'));
  }, 120_000);

  it('없는 파일 pull은 SyncResult 실패', async () => {
    const result = await dadb.pull(() => {}, `${REMOTE_DIR}/dadb-ts-missing`);
    expect(result.success).toBe(false);
  });

  it('reverse: 기기 앱(nc) → 호스트 로컬 서버', async () => {
    const server = net.createServer((socket) => {
      socket.on('error', () => {});
      socket.on('data', (d) => socket.end(d.toString().toUpperCase()));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const localPort = (server.address() as net.AddressInfo).port;
    try {
      const rule = await dadb.reverse('tcp:0', `tcp:${localPort}`);
      log(`reverse 기기 tcp:${rule.devicePort} → 호스트 tcp:${localPort}`);
      expect((await dadb.listReverse()).some((r) => r.remote === rule.remote)).toBe(true);

      const r = await dadb.shell(`echo ping | toybox nc -w 3 127.0.0.1 ${rule.devicePort}`);
      expect(r.output.trim()).toBe('PING');

      await rule.close();
      expect((await dadb.listReverse()).some((x) => x.remote === rule.remote)).toBe(false);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('reverse: 앱 시나리오와 같은 고정 포트(tcp:8080 → 로컬 프록시 포트)', async () => {
    const server = net.createServer((socket) => {
      socket.on('error', () => {});
      socket.on('data', () => socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok'));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const localPort = (server.address() as net.AddressInfo).port;
    try {
      const rule = await dadb.reverse('tcp:18080', `tcp:${localPort}`);
      const r = await dadb.shell(`printf 'GET / HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n' | toybox nc -w 3 127.0.0.1 18080`);
      expect(r.output).toContain('200 OK');
      await rule.close();
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('tcpForward: 호스트 포트 → 기기에서 리슨 중인 nc', async () => {
    const devicePort = 18888;
    // 기기에서 한 번 응답하고 끝나는 리스너(끝날 때까지 셸이 블록되므로 기다리지 않는다).
    const listener = dadb.shell(`echo from-device | toybox nc -l -p ${devicePort}`);
    await new Promise((r) => setTimeout(r, 800));

    const tunnel = await dadb.tcpForward(0, devicePort);
    try {
      const received = await new Promise<string>((resolve, reject) => {
        const socket = net.connect(tunnel.port, '127.0.0.1');
        const chunks: Buffer[] = [];
        socket.on('data', (c) => chunks.push(c));
        socket.on('close', () => resolve(Buffer.concat(chunks).toString()));
        socket.on('error', reject);
        setTimeout(() => socket.end(), 3000);
      });
      expect(received.trim()).toBe('from-device');
    } finally {
      await tunnel.close();
      await listener.catch(() => undefined);
    }
  }, 20_000);

  it('close 후 재연결(인터페이스 해제·재점유)', async () => {
    await dadb.close();
    const r = await dadb.shell('echo again');
    expect(r.output).toBe('again\n');
  });

  it.skipIf(!process.env.ADB_TEST_APK)('install / uninstall', async () => {
    const pkg = process.env.ADB_TEST_APK_PACKAGE!;
    const started = Date.now();
    expect(await dadb.install(process.env.ADB_TEST_APK!, '-r')).toEqual({ success: true });
    log(`install ${Date.now() - started}ms`);
    expect((await dadb.shell(`pm path ${pkg}`)).output).toContain('package:');
    expect(await dadb.uninstall(pkg)).toEqual({ success: true });
    expect((await dadb.shell(`pm path ${pkg}`)).exitCode).not.toBe(0);
  }, 180_000);
});
