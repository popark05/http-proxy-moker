import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannels, type MokerApi, type PingRequest, type ProxyStartArgs } from '@shared/ipc';
import type { CaptureEvent, CapturedExchange } from '@shared/capture';
import type { CaExportFormat } from '@shared/certificate';
import type { DevicePlatform, AndroidInterceptionMode } from '@shared/device';
import type { MockScenario, ApplyMocksArgs } from '@shared/mock';

const api: MokerApi = {
  ping: (request: PingRequest) => ipcRenderer.invoke(IpcChannels.ping, request),

  proxy: {
    start: (args?: ProxyStartArgs) => ipcRenderer.invoke(IpcChannels.proxyStart, args),
    stop: () => ipcRenderer.invoke(IpcChannels.proxyStop),
    status: () => ipcRenderer.invoke(IpcChannels.proxyStatus),
    applyMocks: (args: ApplyMocksArgs) => ipcRenderer.invoke(IpcChannels.proxyApplyMocks, args),
    clearMocks: () => ipcRenderer.invoke(IpcChannels.proxyClearMocks)
  },

  onCaptureEvent: (listener: (event: CaptureEvent) => void) => {
    const handler = (_event: IpcRendererEvent, payload: CaptureEvent): void => listener(payload);
    ipcRenderer.on(IpcChannels.captureEvent, handler);
    return () => ipcRenderer.removeListener(IpcChannels.captureEvent, handler);
  },

  ca: {
    info: () => ipcRenderer.invoke(IpcChannels.caInfo),
    export: (format: CaExportFormat) => ipcRenderer.invoke(IpcChannels.caExport, format)
  },

  device: {
    list: () => ipcRenderer.invoke(IpcChannels.deviceList),
    startInterception: (
      platform: DevicePlatform,
      deviceId: string,
      androidMode?: AndroidInterceptionMode
    ) => ipcRenderer.invoke(IpcChannels.deviceStartInterception, platform, deviceId, androidMode),
    stopInterception: (platform: DevicePlatform, deviceId: string) =>
      ipcRenderer.invoke(IpcChannels.deviceStopInterception, platform, deviceId),
    setupInstructions: (platform: DevicePlatform) =>
      ipcRenderer.invoke(IpcChannels.deviceSetupInstructions, platform)
  },

  project: {
    create: (name: string) => ipcRenderer.invoke(IpcChannels.projectCreate, name),
    open: () => ipcRenderer.invoke(IpcChannels.projectOpen),
    saveCapture: (name: string, exchanges: CapturedExchange[]) =>
      ipcRenderer.invoke(IpcChannels.projectSaveCapture, name, exchanges),
    loadCapture: (name: string) => ipcRenderer.invoke(IpcChannels.projectLoadCapture, name),
    saveScenario: (scenario: MockScenario) =>
      ipcRenderer.invoke(IpcChannels.projectSaveScenario, scenario),
    loadScenario: (name: string) => ipcRenderer.invoke(IpcChannels.projectLoadScenario, name),
    deleteScenario: (name: string) => ipcRenderer.invoke(IpcChannels.projectDeleteScenario, name)
  }
};

// contextIsolation이 켜져 있으므로 contextBridge로만 노출한다.
contextBridge.exposeInMainWorld('mokerApi', api);
