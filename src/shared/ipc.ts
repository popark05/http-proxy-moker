/**
 * main <-> renderer 간 IPC 계약 정의.
 * 채널 이름과 요청/응답 타입을 한 곳에 모아 preload/main/renderer가 공유한다.
 */

import type { CaptureEvent, CapturedExchange, ProxyStatus } from './capture';
import type { CaInfo, CaExportFormat } from './certificate';
import type {
  AndroidInterceptionMode,
  AndroidTrafficPath,
  DeviceInfo,
  DevicePlatform,
  InterceptionResult,
  SetupStep
} from './device';
import type { OpenProject } from './project';
import type { OperationProgress } from './progress';
import type { InterceptionLiveness } from './interception-liveness';
import type { ApplyMocksArgs } from './mock';
import type { CaseLibrary, ScenarioFile } from './scenario-library';
import type { Contract, ContractRunOptions, ContractRunResult, ContractServer } from './contract';

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
  /** 시작/해제 작업의 진행 단계 push(main → renderer). payload: OperationProgress */
  operationProgress: 'operation:progress',

  /** CA 정보 조회 → CaInfo */
  caInfo: 'ca:info',
  /** CA를 파일로 내보내기(저장 다이얼로그). arg: format → 저장 경로 or null(취소) */
  caExport: 'ca:export',

  /** 연결된 기기 목록 조회 → DeviceInfo[] */
  deviceList: 'device:list',
  /** 기기 인터셉션 시작. arg: deviceId → InterceptionResult */
  deviceStartInterception: 'device:start-interception',
  /** 기기 인터셉션 해제. arg: deviceId */
  /** 시작한 인터셉션이 기기에서 아직 살아 있는지 확인 → InterceptionLiveness */
  deviceInterceptionStatus: 'device:interception-status',
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
  projectDeleteScenario: 'project:delete-scenario',
  /** 모든 시나리오 로드(v1/v2). */
  projectLoadAllScenarios: 'project:load-all-scenarios',
  /** 케이스 라이브러리 로드/저장. */
  projectLoadLibrary: 'project:load-library',
  projectSaveLibrary: 'project:save-library',
  /** 계약 저장(arg: contract → 저장된 이름)/전체 로드/삭제(arg: name). */
  projectSaveContract: 'project:save-contract',
  projectLoadAllContracts: 'project:load-all-contracts',
  projectDeleteContract: 'project:delete-contract',
  /** 계약 실행. arg: {contracts, options} → ContractRunResult[] (개별 결과는 contractResult로 push). */
  projectLoadContractServers: 'project:load-contract-servers',
  projectSaveContractServers: 'project:save-contract-servers',
  contractRun: 'contract:run',
  contractResult: 'contract:result',
  /** Bruno 컬렉션 내보내기(폴더 선택) → {dir, files} | null. arg: {name, contracts, servers} */
  contractExportBruno: 'contract:export-bruno',
  /** Bruno 컬렉션 가져오기(폴더 선택) → {contracts, notes, skippedFiles} | null */
  contractImportBruno: 'contract:import-bruno'
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

  /** 시작/해제 작업의 진행 단계 구독(로딩 토스트용). 해제 함수를 반환. */
  onOperationProgress(listener: (progress: OperationProgress) => void): () => void;

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
      androidMode?: AndroidInterceptionMode,
      trafficPath?: AndroidTrafficPath
    ): Promise<InterceptionResult>;
    interceptionStatus(
      platform: DevicePlatform,
      deviceId: string,
      usedMode: InterceptionResult['usedMode']
    ): Promise<InterceptionLiveness>;
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
    /** 시나리오 저장. 파일 기준(살균된) 시나리오명 반환. */
    saveScenario(scenario: ScenarioFile): Promise<string>;
    /** 시나리오 로드(v1/v2). */
    loadScenario(name: string): Promise<ScenarioFile>;
    /** 모든 시나리오 로드(상속/사용처 계산용). */
    loadAllScenarios(): Promise<ScenarioFile[]>;
    /** 케이스 라이브러리 로드(없으면 빈 라이브러리). */
    loadLibrary(): Promise<CaseLibrary>;
    /** 케이스 라이브러리 저장. */
    saveLibrary(library: CaseLibrary): Promise<void>;
    /** 목 시나리오 삭제. */
    deleteScenario(name: string): Promise<void>;
    /** 계약 저장. 파일 기준(살균된) 계약명 반환. */
    saveContract(contract: Contract): Promise<string>;
    /** 모든 계약 로드. */
    loadAllContracts(): Promise<Contract[]>;
    /** 계약 삭제. */
    deleteContract(name: string): Promise<void>;
    /** 계약 실행 대상 서버 목록 로드/저장. */
    loadContractServers(): Promise<ContractServer[]>;
    saveContractServers(servers: ContractServer[]): Promise<void>;
  };
  contract: {
    /** 계약을 실제 서버로 실행(순정 Node 워커). 전체 결과 반환. */
    run(contracts: Contract[], options: ContractRunOptions): Promise<ContractRunResult[]>;
    /** 실행 중 계약 하나가 끝날 때마다 호출. 구독 해제 함수를 반환. */
    onResult(listener: (result: ContractRunResult) => void): () => void;
    /** 계약을 Bruno 컬렉션으로 내보낸다(이미 컬렉션인 폴더를 고르면 거기에 추가). 취소하면 null. */
    exportBruno(name: string, contracts: Contract[], servers: ContractServer[]): Promise<{ dir: string; files: number; merged: boolean; added: number; existing: number } | null>;
    /** Bruno 컬렉션 폴더를 계약으로 가져온다(저장은 하지 않음). 취소하면 null. */
    importBruno(): Promise<{ contracts: Contract[]; notes: string[]; skippedFiles: number } | null>;
  };
}

export const DEFAULT_PROXY_PORT = 8080;
