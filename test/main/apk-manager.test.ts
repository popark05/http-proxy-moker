// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ApkManager, parseRelease } from '../../src/main/device/android/apk-manager';

let dir: string | undefined;

afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('parseRelease', () => {
  it('httptoolkit.apk asset과 버전을 추출', () => {
    const release = parseRelease({
      name: 'v1.2.3',
      assets: [
        { name: 'other.txt', browser_download_url: 'x' },
        { name: 'httptoolkit.apk', browser_download_url: 'https://dl/httptoolkit.apk' }
      ]
    });
    expect(release).toEqual({ version: 'v1.2.3', url: 'https://dl/httptoolkit.apk' });
  });

  it('asset이 없으면 undefined', () => {
    expect(parseRelease({ name: 'v1', assets: [] })).toBeUndefined();
  });

  it('tag_name을 name 대신 사용', () => {
    const release = parseRelease({
      tag_name: 'v2.0.0',
      assets: [{ name: 'httptoolkit.apk', browser_download_url: 'u' }]
    });
    expect(release?.version).toBe('v2.0.0');
  });
});

/** 간단한 fetch 목: 릴리스 API와 다운로드 URL에 각각 응답. */
function makeFetch(apkBytes: Buffer): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/releases/latest') && url.includes('api.github.com')) {
      return new Response(
        JSON.stringify({
          name: 'v1.0.0',
          assets: [{ name: 'httptoolkit.apk', browser_download_url: 'https://dl/httptoolkit.apk' }]
        }),
        { status: 200 }
      );
    }
    // 다운로드
    return new Response(apkBytes, { status: 200 });
  }) as unknown as typeof fetch;
}

describe('ApkManager', () => {
  it('캐시가 없으면 다운로드해 저장하고 경로를 반환', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-apk-'));
    const bytes = Buffer.from('FAKE_APK_CONTENT');
    const manager = new ApkManager(dir, makeFetch(bytes));

    const apkPath = await manager.ensureApk();
    const saved = await fs.readFile(apkPath);
    expect(saved.toString()).toBe('FAKE_APK_CONTENT');
  });

  it('캐시가 있으면 다운로드하지 않고 캐시 경로 반환', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-apk-'));
    const fetchSpy = makeFetch(Buffer.from('X'));
    const manager = new ApkManager(dir, fetchSpy);

    await manager.ensureApk(); // 첫 다운로드
    (fetchSpy as unknown as ReturnType<typeof vi.fn>).mockClear();

    const cached = await manager.ensureApk(); // 캐시 사용
    expect(cached).toContain('httptoolkit-companion.apk');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('릴리스 API 실패 시 폴백 URL로 다운로드', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-apk-'));
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.github.com')) {
        return new Response('rate limited', { status: 403 });
      }
      // 폴백 다운로드 URL
      expect(url).toContain('/releases/latest/download/httptoolkit.apk');
      return new Response(Buffer.from('FALLBACK'), { status: 200 });
    }) as unknown as typeof fetch;

    const manager = new ApkManager(dir, fetchImpl);
    const apkPath = await manager.download();
    expect((await fs.readFile(apkPath)).toString()).toBe('FALLBACK');
  });

  it('clearCache는 캐시를 삭제', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-apk-'));
    const manager = new ApkManager(dir, makeFetch(Buffer.from('X')));
    await manager.ensureApk();
    await manager.clearCache();
    expect(await manager.getCachedApkPath()).toBeUndefined();
  });
});
