import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { app, BrowserWindow, nativeImage, nativeTheme } from 'electron';
import { registerIpcHandlers } from './ipc-handlers';

// 데스크탑 QA 도구는 다크모드를 기본으로 한다. OS 테마를 따라가되 다크를 선호.
nativeTheme.themeSource = 'dark';

/** 앱 아이콘 경로(빌드 산출물 기준 상대). dev/prod 모두 build/icon.png를 참조. */
function resolveAppIcon(): string | undefined {
  const candidates = [
    join(__dirname, '../../build/icon.png'), // dev: out/main → 프로젝트 루트/build
    join(process.resourcesPath ?? '', 'icon.png')
  ];
  return candidates.find((p) => p && existsSync(p));
}

let mainWindow: BrowserWindow | undefined;

function createMainWindow(): BrowserWindow {
  const iconPath = resolveAppIcon();
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#16181e',
    titleBarStyle: 'hiddenInset',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  window.on('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined;
  });
  mainWindow = window;

  // preload 로드 실패는 renderer 전체를 무력화하므로 로그로 남긴다.
  window.webContents.on('preload-error', (_e, preloadPath, error) => {
    console.error(`[preload-error] ${preloadPath}: ${error?.message}`);
  });

  // electron-vite는 dev 서버 URL을 ELECTRON_RENDERER_URL로 주입한다.
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
}

app.whenReady().then(() => {
  // macOS dock 아이콘(dev 포함). 패키징 시엔 icns가 우선하지만 dev 편의를 위해 설정.
  const iconPath = resolveAppIcon();
  if (iconPath && process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(iconPath));
  }

  registerIpcHandlers(() => mainWindow);
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
