/**
 * 프로젝트/시나리오 관련 공유 타입.
 * 프로젝트는 로컬 디렉토리(Git 공유 가능)로, 다음 구조를 갖는다:
 *   project.json         프로젝트 메타
 *   captures/<name>.har.json   캡처 세션(HAR 1.2 확장)
 *   scenarios/<name>.json      목 시나리오(mockttp Serialized<RequestRuleData>[])
 */

export const PROJECT_FILE = 'project.json';
export const CAPTURES_DIR = 'captures';
export const SCENARIOS_DIR = 'scenarios';

export interface ProjectMeta {
  /** 포맷 버전(향후 마이그레이션용). */
  version: 1;
  name: string;
  /** 기본 프록시 포트. */
  proxyPort: number;
  /** 관심 대상 호스트(선택, 필터 힌트). */
  targetHosts: string[];
  createdAt: number;
}

/** 열린 프로젝트의 런타임 상태. */
export interface OpenProject {
  /** 프로젝트 루트 디렉토리 절대 경로. */
  dir: string;
  meta: ProjectMeta;
  /** captures/ 안의 세션 파일명(확장자 제외). */
  captureSessions: string[];
  /** scenarios/ 안의 시나리오 파일명(확장자 제외). */
  scenarios: string[];
}
