// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { createDirectAdbClient } from '../../src/main/device/direct-adb-adapter';
import { FakeAndroid } from './adb/fake-android';
import { FakeUsbBackend, FakeUsbDevice } from './adb/fake-usb';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function setup(serial = 'PHONE1') {
  const phone = new FakeAndroid();
  const usbDevice = new FakeUsbDevice(phone.services, serial);
  const backend = new FakeUsbBackend([usbDevice]);
  const client = createDirectAdbClient({
    usbBackend: backend,
    // adb server 대체 경로는 꺼져 있다(기본값). 실제 5037에 닿지 않도록 에뮬레이터 탐색도 끈다.
    dadb: { keyPair: null, includeEmulators: false, usb: { idlePollMs: 20, claimRetries: 0 } }
  });
  cleanups.push(() => client.close());
  return { phone, usbDevice, backend, client };
}

describe('createDirectAdbClient', () => {
  it('USB 기기를 목록에 올리고 연결되면 device 상태', async () => {
    const { client } = setup();
    const list = await client.listDevices();
    expect(list).toEqual([{ id: 'PHONE1', type: 'device', detail: undefined }]);
  });

  it('USB를 점유당하면 offline + 원인 안내(adb server로 대체하지 않음)', async () => {
    const { client, usbDevice } = setup();
    usbDevice.claimError = new Error('claimInterface error: Busy');
    const [record] = await client.listDevices();
    expect(record.type).toBe('offline');
    expect(record.detail).toContain('adb kill-server');
  });

  it('점유가 풀리면 다음 목록 갱신에서 device로 복구', async () => {
    const { client, usbDevice } = setup();
    usbDevice.claimError = new Error('claimInterface error: Busy');
    await client.listDevices();
    usbDevice.claimError = undefined;
    const [record] = await client.listDevices();
    expect(record.type).toBe('device');
  });

  it('shell: 배열 인자는 따옴표로 감싸고, 출력은 stdout+stderr', async () => {
    const { client, phone } = setup();
    await client.listDevices();
    const device = client.getDevice('PHONE1');
    expect(await device.shell('echo hi')).toBe('hi\n');
    await device.shell(['echo', "it's"]).catch(() => undefined);
    expect(phone.shellCommands).toContain(`'echo' 'it'\\''s'`);
  });

  it('pushContent: 기기 파일로 기록', async () => {
    const { client, phone } = setup();
    await client.getDevice('PHONE1').pushContent('CERT', '/data/local/tmp/a.0');
    expect(phone.files.get('/data/local/tmp/a.0')?.data.toString()).toBe('CERT');
  });

  it('reverse: 기기에 규칙을 설치하고 removeReverse로 제거', async () => {
    const { client, phone } = setup();
    const device = client.getDevice('PHONE1');
    await device.reverse('tcp:8080', 'tcp:8080');
    expect([...phone.reverses.values()].flatMap((m) => [...m.keys()])).toContain('tcp:8080');
    await device.removeReverse('tcp:8080');
    expect([...phone.reverses.values()].flatMap((m) => [...m.keys()])).not.toContain('tcp:8080');
  });

  it('isInstalled: pm path 출력으로 판정', async () => {
    const { client } = setup();
    expect(await client.getDevice('PHONE1').isInstalled('tech.httptoolkit.android.v1')).toBe(false);
  });

  it('startActivity/bringToFront: am start 명령 조립 + Error 출력은 예외', async () => {
    const { client, phone } = setup();
    const device = client.getDevice('PHONE1');
    // 가짜 기기는 am을 모르므로(127 stderr) Error 패턴이 없으면 통과한다.
    await device.startActivity({ action: 'tech.httptoolkit.android.ACTIVATE', data: 'https://x/?a=1&b=2', wait: true });
    await device.bringToFront('tech.httptoolkit.android.v1/tech.httptoolkit.android.MainActivity');
    expect(phone.shellCommands).toContain(
      `am start -W -a 'tech.httptoolkit.android.ACTIVATE' -d 'https://x/?a=1&b=2'`
    );
    expect(phone.shellCommands).toContain(
      `am start -n 'tech.httptoolkit.android.v1/tech.httptoolkit.android.MainActivity'`
    );
  });

  it('기기가 사라지면 목록에서 빠진다', async () => {
    const { client, backend } = setup();
    await client.listDevices();
    backend.devices = [];
    expect(await client.listDevices()).toEqual([]);
  });
});
