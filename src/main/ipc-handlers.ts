import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { app, dialog, ipcMain, net, type BrowserWindow } from 'electron';
import {
  IpcChannels,
  DEFAULT_PROXY_PORT,
  type PingRequest,
  type PingResponse,
  type ProxyStartArgs
} from '@shared/ipc';
import type { CaptureEvent } from '@shared/capture';
import { operationId, type ProgressReporter } from '@shared/progress';
import type { CaExportFormat } from '@shared/certificate';
import type {
  DevicePlatform,
  AndroidInterceptionMode,
  AndroidTrafficPath
} from '@shared/device';
import { ProxyService } from './proxy/proxy-service';
import { CaManager } from './cert/ca-manager';
import { generateMobileConfig } from './cert/mobileconfig';
import { DeviceService } from './device/device-service';
import { AndroidConnector } from './device/android/android-connector';
import { ApkManager } from './device/android/apk-manager';
import { IosConnector } from './device/ios/ios-connector';
import { createDirectAdbClient } from './device/direct-adb-adapter';
import { createUsbmuxClient } from './device/usbmux-adapter';
import { getReachableIpv4 } from './device/network';
import { ProjectStore } from './project/project-store';
import type { CapturedExchange } from '@shared/capture';
import type { ApplyMocksArgs } from '@shared/mock';
import type { CaseLibrary, ScenarioFile } from '@shared/scenario-library';
import type { Contract, ContractRunOptions, ContractServer } from '@shared/contract';

/**
 * main 프로세스의 IPC 핸들러를 등록한다.
 * 순수 로직(handlePing 등)은 분리해 단위 테스트가 가능하도록 한다.
 */
export function handlePing(request: PingRequest, now: () => number = Date.now): PingResponse {
  return {
    message: `pong: ${request.message}`,
    repliedAt: now()
  };
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | undefined): void {
  ipcMain.handle(IpcChannels.ping, (_event, request: PingRequest) => handlePing(request));

  // 캡처 이벤트를 활성 window로 push.
  const emit = (event: CaptureEvent): void => {
    const window = getWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send(IpcChannels.captureEvent, event);
    }
  };

  // 시작/해제 작업의 진행 단계를 renderer로 push(로딩 토스트). 보고 실패는 작업에 영향을 주지 않는다.
  const progress =
    (operation: string): ProgressReporter =>
    (step) => {
      const window = getWindow();
      if (window && !window.isDestroyed()) {
        window.webContents.send(IpcChannels.operationProgress, { operation, step });
      }
    };

  const ca = new CaManager(path.join(app.getPath('userData'), 'ca'));
  const proxy = new ProxyService(emit, ca);

  // 앱 종료 시 프록시 워커(자식 프로세스)를 정리한다.
  app.on('will-quit', () => proxy.dispose());

  ipcMain.handle(IpcChannels.proxyStart, (_event, args: ProxyStartArgs | undefined) =>
    proxy.start(args?.port ?? DEFAULT_PROXY_PORT, progress(operationId.proxyStart))
  );
  ipcMain.handle(IpcChannels.proxyStop, () => proxy.stop(progress(operationId.proxyStop)));
  ipcMain.handle(IpcChannels.proxyStatus, () => proxy.getStatus());
  ipcMain.handle(IpcChannels.proxyApplyMocks, (_event, args: ApplyMocksArgs) =>
    proxy.applyMocks(args.mocks, args.unmatchedPolicy)
  );
  ipcMain.handle(IpcChannels.proxyClearMocks, () => proxy.clearMocks());

  ipcMain.handle(IpcChannels.caInfo, () => ca.getInfo());

  ipcMain.handle(IpcChannels.caExport, async (_event, format: CaExportFormat) => {
    const { cert } = await ca.ensureCa();
    const isPem = format === 'pem';
    const defaultName = isPem ? 'moker-ca.pem' : 'moker-ca.mobileconfig';

    const window = getWindow();
    const result = await dialog.showSaveDialog(window ?? undefined!, {
      title: 'CA 인증서 내보내기',
      defaultPath: defaultName,
      filters: isPem
        ? [{ name: 'PEM 인증서', extensions: ['pem', 'crt'] }]
        : [{ name: 'Apple 설정 프로파일', extensions: ['mobileconfig'] }]
    });

    if (result.canceled || !result.filePath) return null;

    const content = isPem ? cert : generateMobileConfig({ certPem: cert });
    await fs.writeFile(result.filePath, content, 'utf-8');
    return result.filePath;
  });

  // --- 기기 연동 ---
  // 인터셉션 옵션은 현재 프록시 상태 + 로컬 IP + CA로 지연 조립.
  // Node fetch는 사내망 SSL 인터셉션 CA를 신뢰하지 않으므로 시스템 인증서 저장소를 쓰는 Electron net.fetch로 받는다.
  const apkManager = new ApkManager(path.join(app.getPath('userData'), 'apk'), net.fetch.bind(net) as typeof fetch);
  const deviceService = new DeviceService(async () => {
    const status = proxy.getStatus();
    const caInfo = await ca.getInfo();
    return {
      proxyHost: getReachableIpv4() ?? '127.0.0.1',
      proxyPort: status.port ?? DEFAULT_PROXY_PORT,
      caPem: caInfo.certPem,
      certFingerprint: caInfo.spkiSha256,
      proxyRunning: status.running
    };
  });
  // adb 바이너리/adb server 없이 직접 USB/TCP로 기기와 통신한다(src/main/adb).
  // EVERMOCK_ADB=server: 진단용 대조군(직접 레이어를 건너뛰고 시스템 adb server만 사용).
  const adbClient = createDirectAdbClient({ adbServerOnly: process.env.EVERMOCK_ADB === 'server' });
  app.on('will-quit', () => void adbClient.close());
  deviceService.register(new AndroidConnector(adbClient, apkManager));
  deviceService.register(new IosConnector(createUsbmuxClient()));

  ipcMain.handle(IpcChannels.deviceList, () => deviceService.listDevices());
  ipcMain.handle(
    IpcChannels.deviceStartInterception,
    (
      _event,
      platform: DevicePlatform,
      deviceId: string,
      androidMode?: AndroidInterceptionMode,
      trafficPath?: AndroidTrafficPath
    ) =>
      deviceService.startInterception(
        platform,
        deviceId,
        androidMode,
        trafficPath,
        progress(operationId.deviceStart(deviceId))
      )
  );
  ipcMain.handle(
    IpcChannels.deviceInterceptionStatus,
    (_event, platform: DevicePlatform, deviceId: string, usedMode: 'root' | 'vpn' | undefined) =>
      deviceService.checkInterception(platform, deviceId, usedMode)
  );
  ipcMain.handle(
    IpcChannels.deviceStopInterception,
    (_event, platform: DevicePlatform, deviceId: string) =>
      deviceService.stopInterception(platform, deviceId, progress(operationId.deviceStop(deviceId)))
  );
  ipcMain.handle(IpcChannels.deviceSetupInstructions, (_event, platform: DevicePlatform) =>
    deviceService.getSetupInstructions(platform)
  );

  // --- 프로젝트 ---
  const projectStore = new ProjectStore();
  let openProjectDir: string | undefined;

  ipcMain.handle(IpcChannels.projectCreate, async (_event, name: string) => {
    const window = getWindow();
    const result = await dialog.showOpenDialog(window ?? undefined!, {
      title: '새 프로젝트 폴더 선택',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const project = await projectStore.create(result.filePaths[0], name || 'Untitled');
    openProjectDir = project.dir;
    return project;
  });

  ipcMain.handle(IpcChannels.projectOpen, async () => {
    const window = getWindow();
    const result = await dialog.showOpenDialog(window ?? undefined!, {
      title: '프로젝트 폴더 열기',
      properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    try {
      const project = await projectStore.open(result.filePaths[0]);
      openProjectDir = project.dir;
      return project;
    } catch {
      return null;
    }
  });

  ipcMain.handle(
    IpcChannels.projectSaveCapture,
    async (_event, name: string, exchanges: CapturedExchange[]) => {
      if (!openProjectDir) throw new Error('열린 프로젝트가 없습니다.');
      return projectStore.saveCaptureSession(openProjectDir, name, exchanges);
    }
  );

  ipcMain.handle(IpcChannels.projectLoadCapture, async (_event, name: string) => {
    if (!openProjectDir) throw new Error('열린 프로젝트가 없습니다.');
    return projectStore.loadCaptureSession(openProjectDir, name);
  });

  ipcMain.handle(IpcChannels.projectSaveScenario, async (_event, scenario: ScenarioFile) => {
    if (!openProjectDir) throw new Error('열린 프로젝트가 없습니다.');
    return projectStore.saveScenario(openProjectDir, scenario);
  });

  ipcMain.handle(IpcChannels.projectLoadScenario, async (_event, name: string) => {
    if (!openProjectDir) throw new Error('열린 프로젝트가 없습니다.');
    return projectStore.loadScenario(openProjectDir, name);
  });

  ipcMain.handle(IpcChannels.projectLoadAllScenarios, async () => {
    if (!openProjectDir) throw new Error('열린 프로젝트가 없습니다.');
    return projectStore.loadAllScenarios(openProjectDir);
  });

  ipcMain.handle(IpcChannels.projectLoadLibrary, async () => {
    if (!openProjectDir) throw new Error('열린 프로젝트가 없습니다.');
    return projectStore.loadLibrary(openProjectDir);
  });

  ipcMain.handle(IpcChannels.projectSaveLibrary, async (_event, library: CaseLibrary) => {
    if (!openProjectDir) throw new Error('열린 프로젝트가 없습니다.');
    return projectStore.saveLibrary(openProjectDir, library);
  });

  ipcMain.handle(IpcChannels.projectDeleteScenario, async (_event, name: string) => {
    if (!openProjectDir) throw new Error('열린 프로젝트가 없습니다.');
    return projectStore.deleteScenario(openProjectDir, name);
  });

  ipcMain.handle(
    IpcChannels.contractRun,
    async (_event, arg: { contracts: Contract[]; options: ContractRunOptions }) =>
      proxy.runContracts(arg.contracts, arg.options, (result) => {
        const window = getWindow();
        if (window && !window.isDestroyed()) window.webContents.send(IpcChannels.contractResult, result);
      })
  );

  ipcMain.handle(IpcChannels.projectSaveContract, async (_event, contract: Contract) => {
    if (!openProjectDir) throw new Error('열린 프로젝트가 없습니다.');
    return projectStore.saveContract(openProjectDir, contract);
  });

  ipcMain.handle(IpcChannels.projectLoadAllContracts, async () => {
    if (!openProjectDir) throw new Error('열린 프로젝트가 없습니다.');
    return projectStore.loadAllContracts(openProjectDir);
  });

  ipcMain.handle(IpcChannels.projectLoadContractServers, async () => {
    if (!openProjectDir) throw new Error('열린 프로젝트가 없습니다.');
    return projectStore.loadContractServers(openProjectDir);
  });

  ipcMain.handle(IpcChannels.projectSaveContractServers, async (_event, servers: ContractServer[]) => {
    if (!openProjectDir) throw new Error('열린 프로젝트가 없습니다.');
    return projectStore.saveContractServers(openProjectDir, servers);
  });

  ipcMain.handle(IpcChannels.projectDeleteContract, async (_event, name: string) => {
    if (!openProjectDir) throw new Error('열린 프로젝트가 없습니다.');
    return projectStore.deleteContract(openProjectDir, name);
  });
}
