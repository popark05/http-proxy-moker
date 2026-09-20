/**
 * main <-> renderer 간 IPC 계약 정의.
 * 채널 이름과 요청/응답 타입을 한 곳에 모아 preload/main/renderer가 공유한다.
 */

import type { CaptureEvent, CapturedExchange, ProxyStatus } from './capture';
import type { CaInfo, CaExportFormat } from './certificate';
import type {
  AndroidInterceptionMode,
  DeviceInfo,
  DevicePlatform,
  InterceptionResult,
  SetupStep
} from './device';
import type { OpenProject } from './project';
import type { MockScenario, ApplyMocksArgs } from './mock';

export const IpcChannels = {
  /** 연결 확인용 왕복(핑퐁). Task 1 데모용. */
  ping: 'app:ping',

  /** 프록시 시작. arg: { port? } → ProxyStatus */
  proxyStart: 'proxy:start',
  /** 프록시 중지 → ProxyStatus */
  proxyStop: 'proxy:stop',
  /** 현재 프록시 상태 조회 → ProxyStatus */
  proxyStatus: 'proxy:status',
  /** 목킹 모드 적용(목 룰 주입). arg: ApplyMocksArgs */
  proxyApplyMocks: 'proxy:apply-mocks',
  /** 목킹 해제(캡처 모드 복귀). */
  proxyClearMocks: 'proxy:clear-mocks',

  /** main → renderer 캡처 이벤트 스트림(단방향 send). */
  captureEvent: 'capture:event',

  /** CA 정보 조회 → CaInfo */
  caInfo: 'ca:info',
  /** CA를 파일로 내보내기(저장 다이얼로그). arg: format → 저장 경로 or null(취소) */
  caExport: 'ca:export',

  /** 연결된 기기 목록 조회 → DeviceInfo[] */
  deviceList: 'device:list',
  /** 기기 인터셉션 시작. arg: deviceId → InterceptionResult */
  deviceStartInterception: 'device:start-interception',
  /** 기기 인터셉션 해제. arg: deviceId */
  deviceStopInterception: 'device:stop-interception',
  /** iOS 등 수동 셋업 안내 조회. arg: platform → SetupStep[] */
  deviceSetupInstructions: 'device:setup-instructions',

  /** 새 프로젝트 생성(디렉토리 선택 다이얼로그) → OpenProject | null */
  projectCreate: 'project:create',
  /** 기존 프로젝트 열기(디렉토리 선택) → OpenProject | null */
  projectOpen: 'project:open',
  /** 캡처 세션 저장. arg: {name, exchanges} → 저장된 세션명 */
  projectSaveCapture: 'project:save-capture',
  /** 캡처 세션 로드. arg: name → CapturedExchange[] */
  projectLoadCapture: 'project:load-capture',
  /** 목 시나리오 저장. arg: scenario → 저장된 시나리오명 */
  projectSaveScenario: 'project:save-scenario',
  /** 목 시나리오 로드. arg: name → MockScenario */
  projectLoadScenario: 'project:load-scenario',
  /** 목 시나리오 삭제. arg: name */
  projectDeleteScenario: 'project:delete-scenario'
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

export interface PingRequest {
  message: string;
}

export interface PingResponse {
  message: string;
  /** main 프로세스가 응답한 시각(epoch ms). */
  repliedAt: number;
}

export interface ProxyStartArgs {
  /** 지정 포트. 생략 시 기본값(8080) 사용. */
  port?: number;
}

/**
 * preload가 renderer에 노출하는 API 표면.
 * window.mokerApi 로 접근한다.
 */
export interface MokerApi {
  ping(request: PingRequest): Promise<PingResponse>;

  proxy: {
    start(args?: ProxyStartArgs): Promise<ProxyStatus>;
    stop(): Promise<ProxyStatus>;
    status(): Promise<ProxyStatus>;
    /** 목킹 모드 적용(목 룰 주입). */
    applyMocks(args: ApplyMocksArgs): Promise<void>;
    /** 목킹 해제(캡처 모드 복귀). */
    clearMocks(): Promise<void>;
  };

  /** 캡처 이벤트 구독. 해제 함수를 반환. */
  onCaptureEvent(listener: (event: CaptureEvent) => void): () => void;

  ca: {
    info(): Promise<CaInfo>;
    /** CA를 파일로 저장. 저장한 경로 반환, 취소 시 null. */
    export(format: CaExportFormat): Promise<string | null>;
  };

  device: {
    list(): Promise<DeviceInfo[]>;
    startInterception(
      platform: DevicePlatform,
      deviceId: string,
      androidMode?: AndroidInterceptionMode
    ): Promise<InterceptionResult>;
    stopInterception(platform: DevicePlatform, deviceId: string): Promise<void>;
    setupInstructions(platform: DevicePlatform): Promise<SetupStep[]>;
  };

  project: {
    /** 디렉토리 선택 후 새 프로젝트 생성. 취소 시 null. */
    create(name: string): Promise<OpenProject | null>;
    /** 디렉토리 선택 후 기존 프로젝트 열기. 취소/실패 시 null. */
    open(): Promise<OpenProject | null>;
    /** 캡처 세션 저장. 저장된 세션명 반환. */
    saveCapture(name: string, exchanges: CapturedExchange[]): Promise<string>;
    /** 캡처 세션 로드. */
    loadCapture(name: string): Promise<CapturedExchange[]>;
    /** 목 시나리오 저장. 저장된 시나리오명 반환. */
    saveScenario(scenario: MockScenario): Promise<string>;
    /** 목 시나리오 로드. */
    loadScenario(name: string): Promise<MockScenario>;
    /** 목 시나리오 삭제. */
    deleteScenario(name: string): Promise<void>;
  };
}

export const DEFAULT_PROXY_PORT = 8080;
