import { promises as fs, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as path from 'node:path';

const APK_REPO = 'httptoolkit/httptoolkit-android';
const RELEASE_API = `https://api.github.com/repos/${APK_REPO}/releases/latest`;
const APK_ASSET_NAME = 'httptoolkit.apk';
/** 릴리스를 확인할 수 없을 때(rate limit 등) 쓰는 고정 최신 다운로드 URL. */
const FALLBACK_APK_URL = `https://github.com/${APK_REPO}/releases/latest/download/${APK_ASSET_NAME}`;

export interface ReleaseInfo {
  version: string;
  url: string;
}

/** GitHub API에서 응답을 파싱해 릴리스 정보를 추출(테스트 가능한 순수 함수). */
export function parseRelease(json: unknown): ReleaseInfo | undefined {
  const release = json as {
    name?: string;
    tag_name?: string;
    assets?: Array<{ name: string; browser_download_url: string }>;
  };
  const asset = release.assets?.find((a) => a.name === APK_ASSET_NAME);
  const version = release.name || release.tag_name;
  if (!asset || !version) return undefined;
  return { version, url: asset.browser_download_url };
}

/** 로컬 캐시 APK 파일명(단일 캐시). */
const CACHE_FILENAME = 'httptoolkit-companion.apk';

/**
 * companion APK를 GitHub 릴리스에서 받아 캐시하고 로컬 경로를 반환한다.
 * - 캐시가 있으면 그대로 사용(오프라인/속도).
 * - 없으면 최신 릴리스를 다운로드해 캐시.
 */
export class ApkManager {
  private readonly cachePath: string;

  constructor(
    private readonly dataDir: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.cachePath = path.join(dataDir, CACHE_FILENAME);
  }

  /** 캐시된 APK 경로(없으면 undefined). */
  async getCachedApkPath(): Promise<string | undefined> {
    try {
      await fs.access(this.cachePath);
      return this.cachePath;
    } catch {
      return undefined;
    }
  }

  /** APK를 확보(캐시 우선, 없으면 다운로드)해 로컬 경로를 반환. */
  async ensureApk(): Promise<string> {
    const cached = await this.getCachedApkPath();
    if (cached) return cached;
    return this.download();
  }

  /** 최신 릴리스를 다운로드해 캐시 경로에 저장. */
  async download(): Promise<string> {
    const url = await this.resolveDownloadUrl();

    const response = await this.fetchImpl(url);
    if (!response.ok || !response.body) {
      throw new Error(`APK 다운로드 실패: ${response.status}`);
    }

    await fs.mkdir(this.dataDir, { recursive: true });
    const tmpPath = `${this.cachePath}.tmp`;
    // web ReadableStream → Node stream 파이프.
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(tmpPath));
    await fs.rename(tmpPath, this.cachePath);
    return this.cachePath;
  }

  /** 다운로드 URL 결정(릴리스 API 조회, 실패 시 폴백 URL). */
  private async resolveDownloadUrl(): Promise<string> {
    try {
      const res = await this.fetchImpl(RELEASE_API);
      if (res.ok) {
        const release = parseRelease(await res.json());
        if (release) return release.url;
      }
    } catch {
      // 네트워크/rate limit 등 → 폴백.
    }
    return FALLBACK_APK_URL;
  }

  /** 캐시된 APK 삭제(설치 실패 재시도용). */
  async clearCache(): Promise<void> {
    await fs.rm(this.cachePath, { force: true });
  }
}
