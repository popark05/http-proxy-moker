import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { app, dialog, ipcMain, type BrowserWindow } from 'electron';
import {
  IpcChannels,
  DEFAULT_PROXY_PORT,
  type PingRequest,
  type PingResponse,
  type ProxyStartArgs
} from '@shared/ipc';
import type { CaptureEvent } from '@shared/capture';
import type { CaExportFormat } from '@shared/certificate';
import type { DevicePlatform, AndroidInterceptionMode } from '@shared/device';
import { ProxyService } from './proxy/proxy-service';
import { CaManager } from './cert/ca-manager';
import { generateMobileConfig } from './cert/mobileconfig';
import { DeviceService } from './device/device-service';
import { AndroidConnector } from './device/android/android-connector';
import { ApkManager } from './device/android/apk-manager';
import { IosConnector } from './device/ios/ios-connector';
import { createAdbkitClient } from './device/adbkit-adapter';
import { createUsbmuxClient } from './device/usbmux-adapter';
import { getReachableIpv4 } from './device/network';
import { ProjectStore } from './project/project-store';
import type { CapturedExchange } from '@shared/capture';
import type { MockScenario, ApplyMocksArgs } from '@shared/mock';

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

  const ca = new CaManager(path.join(app.getPath('userData'), 'ca'));
  const proxy = new ProxyService(emit, ca);

  // 앱 종료 시 프록시 워커(자식 프로세스)를 정리한다.
  app.on('will-quit', () => proxy.dispose());

  ipcMain.handle(IpcChannels.proxyStart, (_event, args: ProxyStartArgs | undefined) =>
    proxy.start(args?.port ?? DEFAULT_PROXY_PORT)
  );
  ipcMain.handle(IpcChannels.proxyStop, () => proxy.stop());
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
  const apkManager = new ApkManager(path.join(app.getPath('userData'), 'apk'));
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
  deviceService.register(new AndroidConnector(createAdbkitClient(), apkManager));
  deviceService.register(new IosConnector(createUsbmuxClient()));

  ipcMain.handle(IpcChannels.deviceList, () => deviceService.listDevices());
  ipcMain.handle(
    IpcChannels.deviceStartInterception,
    (_event, platform: DevicePlatform, deviceId: string, androidMode?: AndroidInterceptionMode) =>
      deviceService.startInterception(platform, deviceId, androidMode)
  );
  ipcMain.handle(
    IpcChannels.deviceStopInterception,
    (_event, platform: DevicePlatform, deviceId: string) =>
      deviceService.stopInterception(platform, deviceId)
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

  ipcMain.handle(IpcChannels.projectSaveScenario, async (_event, scenario: MockScenario) => {
    if (!openProjectDir) throw new Error('열린 프로젝트가 없습니다.');
    return projectStore.saveScenario(openProjectDir, scenario);
  });

  ipcMain.handle(IpcChannels.projectLoadScenario, async (_event, name: string) => {
    if (!openProjectDir) throw new Error('열린 프로젝트가 없습니다.');
    return projectStore.loadScenario(openProjectDir, name);
  });

  ipcMain.handle(IpcChannels.projectDeleteScenario, async (_event, name: string) => {
    if (!openProjectDir) throw new Error('열린 프로젝트가 없습니다.');
    return projectStore.deleteScenario(openProjectDir, name);
  });
}
