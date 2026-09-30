import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  PROJECT_FILE,
  CAPTURES_DIR,
  SCENARIOS_DIR,
  type ProjectMeta,
  type OpenProject
} from '@shared/project';
import type { CapturedExchange } from '@shared/capture';
import { exchangesToHar, harToExchanges, type Har } from '@shared/har';
import type { MockScenario } from '@shared/mock';
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

  /** 목 시나리오를 저장. 저장된 시나리오명 반환. */
  async saveScenario(dir: string, scenario: MockScenario): Promise<string> {
    const safe = sanitizeName(scenario.name);
    const filePath = path.join(dir, SCENARIOS_DIR, `${safe}.json`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(scenario, null, 2), 'utf-8');
    return safe;
  }

  /** 목 시나리오를 로드. */
  async loadScenario(dir: string, name: string): Promise<MockScenario> {
    const safe = sanitizeName(name);
    const filePath = path.join(dir, SCENARIOS_DIR, `${safe}.json`);
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as MockScenario;
  }

  /** 목 시나리오를 삭제. */
  async deleteScenario(dir: string, name: string): Promise<void> {
    const safe = sanitizeName(name);
    const filePath = path.join(dir, SCENARIOS_DIR, `${safe}.json`);
    await fs.rm(filePath, { force: true });
  }
}
