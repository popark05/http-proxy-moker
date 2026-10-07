import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  PROJECT_FILE,
  CAPTURES_DIR,
  SCENARIOS_DIR,
  LIBRARY_FILE,
  type ProjectMeta,
  type OpenProject
} from '@shared/project';
import type { CapturedExchange } from '@shared/capture';
import { exchangesToHar, harToExchanges, type Har } from '@shared/har';
import { EMPTY_LIBRARY, parseLibrary, type CaseLibrary, type ScenarioFile } from '@shared/scenario-library';
import { DEFAULT_PROXY_PORT } from '@shared/ipc';

/** Windows 예약 장치 이름(확장자가 있어도 예약됨). */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * 경로 탈출/특수문자를 제거해 안전한 파일명만 남긴다.
 * 한글 등 유니코드 글자·숫자는 보존한다(전부 `_`로 뭉개져 충돌하던 문제 방지).
 * 대소문자만 다른 이름은 macOS/Windows 파일시스템에서 같은 파일이 된다는 점은 그대로다.
 */
function sanitizeName(name: string): string {
  let cleaned = name
    .normalize('NFC') // macOS(NFD)와 Windows(NFC)에서 같은 한글 이름이 같은 파일이 되게
    .replace(/[. ]+$/, '') // Windows는 끝의 점/공백을 떼어 버린다(공백이 `_`로 바뀌기 전에 처리)
    .replace(/\.\.+/g, '_') // 연속된 점(경로 탈출) 제거
    .replace(/[^\p{L}\p{N}._-]/gu, '_'); // 허용 문자 외 치환
  if (WINDOWS_RESERVED.test(cleaned)) cleaned = `_${cleaned}`;
  return cleaned || 'untitled';
}

/**
 * 프로젝트 디렉토리 기반 저장소.
 * project.json / captures/ / scenarios/ 구조를 읽고 쓴다.
 */
export class ProjectStore {
  /** 새 프로젝트를 생성(디렉토리 초기화 + project.json). */
  async create(dir: string, name: string): Promise<OpenProject> {
    const meta: ProjectMeta = {
      version: 1,
      name,
      proxyPort: DEFAULT_PROXY_PORT,
      targetHosts: [],
      createdAt: Date.now()
    };
    await fs.mkdir(path.join(dir, CAPTURES_DIR), { recursive: true });
    await fs.mkdir(path.join(dir, SCENARIOS_DIR), { recursive: true });
    await fs.writeFile(path.join(dir, PROJECT_FILE), JSON.stringify(meta, null, 2), 'utf-8');
    return this.open(dir);
  }

  /** 기존 프로젝트를 연다. project.json이 없으면 예외. */
  async open(dir: string): Promise<OpenProject> {
    const metaRaw = await fs.readFile(path.join(dir, PROJECT_FILE), 'utf-8');
    const meta = JSON.parse(metaRaw) as ProjectMeta;
    const captureSessions = await this.listNames(path.join(dir, CAPTURES_DIR), '.har.json');
    const scenarios = await this.listNames(path.join(dir, SCENARIOS_DIR), '.json');
    return { dir, meta, captureSessions, scenarios };
  }

  private async listNames(dir: string, suffix: string): Promise<string[]> {
    try {
      const files = await fs.readdir(dir);
      return files
        .filter((f) => f.endsWith(suffix))
        .map((f) => f.slice(0, -suffix.length))
        .sort();
    } catch {
      return [];
    }
  }

  /** 캡처 세션을 HAR 파일로 저장. */
  async saveCaptureSession(
    dir: string,
    name: string,
    exchanges: CapturedExchange[]
  ): Promise<string> {
    const safe = sanitizeName(name);
    const filePath = path.join(dir, CAPTURES_DIR, `${safe}.har.json`);
    const har = exchangesToHar(exchanges);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(har, null, 2), 'utf-8');
    return safe;
  }

  /** 저장된 캡처 세션(HAR)을 로드해 exchange 배열로 반환. */
  async loadCaptureSession(dir: string, name: string): Promise<CapturedExchange[]> {
    const safe = sanitizeName(name);
    const filePath = path.join(dir, CAPTURES_DIR, `${safe}.har.json`);
    const raw = await fs.readFile(filePath, 'utf-8');
    const har = JSON.parse(raw) as Har;
    return harToExchanges(har);
  }

  /**
   * 시나리오를 저장하고 파일 기준 이름(살균된 이름)을 반환한다.
   * 파일 안의 name도 같은 값으로 맞춰서, 시나리오끼리의 상속(base) 참조가 파일명과 어긋나지 않게 한다.
   */
  async saveScenario(dir: string, scenario: ScenarioFile): Promise<string> {
    const safe = sanitizeName(scenario.name);
    const filePath = path.join(dir, SCENARIOS_DIR, `${safe}.json`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    // v1(목 복사본)을 v2로 바꿔 쓰기 전에 원본을 한 번 보관한다(.v1.bak은 시나리오 목록에 나타나지 않는다).
    if (scenario.version === 2) {
      try {
        const existing = JSON.parse(await fs.readFile(filePath, 'utf-8')) as { version?: number };
        if (existing.version === 1) await fs.copyFile(filePath, path.join(path.dirname(filePath), `${safe}.v1.bak`));
      } catch {
        // 기존 파일이 없거나 읽을 수 없으면 백업할 것이 없다.
      }
    }
    await fs.writeFile(filePath, JSON.stringify({ ...scenario, name: safe }, null, 2), 'utf-8');
    return safe;
  }

  /** 시나리오를 로드(v1/v2 그대로). name은 파일명으로 맞춘다. */
  async loadScenario(dir: string, name: string): Promise<ScenarioFile> {
    const safe = sanitizeName(name);
    const filePath = path.join(dir, SCENARIOS_DIR, `${safe}.json`);
    const raw = await fs.readFile(filePath, 'utf-8');
    return { ...(JSON.parse(raw) as ScenarioFile), name: safe };
  }

  /** scenarios/ 의 모든 시나리오(깨진 파일은 건너뜀). 상속 해석과 사용처 계산에 쓴다. */
  async loadAllScenarios(dir: string): Promise<ScenarioFile[]> {
    const names = await this.listNames(path.join(dir, SCENARIOS_DIR), '.json');
    const loaded = await Promise.all(names.map((n) => this.loadScenario(dir, n).catch(() => undefined)));
    return loaded.filter((s): s is ScenarioFile => !!s);
  }

  /** 케이스 라이브러리(library.json). 없거나 깨졌으면 빈 라이브러리. */
  async loadLibrary(dir: string): Promise<CaseLibrary> {
    try {
      return parseLibrary(JSON.parse(await fs.readFile(path.join(dir, LIBRARY_FILE), 'utf-8')));
    } catch {
      return EMPTY_LIBRARY;
    }
  }

  async saveLibrary(dir: string, library: CaseLibrary): Promise<void> {
    await fs.writeFile(path.join(dir, LIBRARY_FILE), JSON.stringify(library, null, 2), 'utf-8');
  }

  /** 목 시나리오를 삭제. */
  async deleteScenario(dir: string, name: string): Promise<void> {
    const safe = sanitizeName(name);
    const filePath = path.join(dir, SCENARIOS_DIR, `${safe}.json`);
    await fs.rm(filePath, { force: true });
  }
}
