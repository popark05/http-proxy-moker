# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

EverMock (package name `moker-proxy`): an internal QA macOS desktop app. It captures API traffic from mobile apps (Android + iOS), lets you clone and edit captured responses into mock definitions, and in mock mode serves only local mock responses without calling the backend. It is not distributed publicly. Code comments, UI strings and commit messages are in Korean, so match that.

`reference/` (git-ignored) holds HTTP Toolkit source under AGPL. Use it **for reference only**: read its patterns and APIs, but never copy its code into `src/`.

## Commands

```bash
npm run dev            # electron-vite dev mode (HMR)
npm run build          # typecheck + electron-vite build → out/
npm run typecheck      # tsconfig.node.json (main/preload/shared) + tsconfig.web.json (renderer)
npm test               # vitest run (all tests)
npx vitest run test/main/proxy-service.test.ts   # single file
npx vitest run -t "test name substring"          # single test by name
npm run dist:mac       # fetch-node + build + electron-builder DMG (arm64/x64) → release/
node scripts/verify-vpn.mjs <deviceId>           # real-device Android VPN capture check
```

Tests live in `test/{main,renderer,shared}` and mirror `src/`. The default environment is jsdom. Tests that use real sockets or mockttp (for example `https-capture`) start with `// @vitest-environment node`.

## Architecture

It's a three-process Electron app plus a separate **proxy worker** process:

- **`src/main/`**: the Electron main process. `index.ts` creates the window, and `ipc-handlers.ts` wires every service (`ProxyService`, `CaManager`, `DeviceService` with Android/iOS connectors, `ProjectStore`) to `ipcMain.handle` channels.
- **`src/preload/`**: exposes `window.mokerApi` through contextBridge. It's built as **CJS (`index.cjs`)** because `package.json` has `"type": "module"`.
- **`src/renderer/`**: the React UI. State lives in hooks under `state/` (`useCapture`, `useMocks`, `useProject`, `useTrafficFilter`, `useMockHits`, and the `app-mode` context: `'capture' | 'mock'`). `App.tsx` coordinates them. For example, an effect re-applies mocks to the proxy whenever the mode, the mocks or the unmatched policy change.
- **`src/shared/`**: types and pure logic shared by main and renderer. `ipc.ts` is the single IPC contract (the `IpcChannels` names plus the `MokerApi` interface). Adding an IPC call means touching `shared/ipc.ts`, `preload/index.ts` and `main/ipc-handlers.ts` together. Pure logic (HAR conversion, capture→mock conversion, traffic filtering) lives here so it can be unit-tested.

### Proxy worker (important)

mockttp's upstream TLS breaks under Electron's BoringSSL (`INVALID_COMMAND`, which makes HTTPS passthrough return 500). The proxy therefore runs in a **separate plain-Node (OpenSSL) child process**:

- `main/proxy/proxy-engine.ts` (`ProxyEngine`): the actual mockttp logic, covering start/stop, mock rule injection, capture subscription and the companion-VPN verification endpoints. Tests instantiate it directly.
- `main/proxy/proxy-worker-entry.ts`: the worker entry point. It's built as a second main input to `out/main/proxy-worker.js`.
- `main/proxy/proxy-service.ts` (`ProxyService`): runs in main. It forks the worker with a real Node binary and talks to it over the `WorkerCommand`/`WorkerMessage` protocol (`shared/proxy-worker.ts`, matched by requestId, with plain structured-cloneable data only). It then relays capture events to the renderer.
- Node binary resolution order: `NODE_BINARY_PATH` env → bundled `resources/node/<arch>/node` (from `npm run fetch-node`, packaged via `extraResources`) → system node. In packaged builds the worker is `asarUnpack`ed, and the path is rewritten to `app.asar.unpacked`.

Applying or clearing mocks calls `server.reset()` and then re-registers the subscriptions, the companion endpoints, the mock rules and the unmatched rule, in that order. Mock hits are tracked through the rule id → mock id map (`ruleToMock`).

### Mocks and projects

- `shared/mock.ts`: `MockDefinition` (method + path matcher, editable response, `delayMs`, `fault` of `timeout|reset|close`, and `originalBody` for the edited-vs-original diff) and `MockScenario`. Mocks are converted to mockttp serialized rules; methods are mockttp's numeric enum (`METHOD_ENUM`).
- A project is a local directory: `project.json`, `captures/<name>.har.json` (HAR 1.2 with extensions such as `_tags`), and `scenarios/<name>.json`.

### Devices

`main/device/device-connector.ts` defines the `DeviceConnector` interface, implemented by `android/android-connector.ts` and `ios/ios-connector.ts` and aggregated by `DeviceService`. Hardware access goes through thin interfaces (`adb-client.ts` and `usbmux-client.ts`, with adapters `adbkit-adapter.ts` and `usbmux-adapter.ts`) so tests can inject fakes.

- **Android** is fully automatic. The modes are `auto`, `system CA (root)` and `VPN (non-root)`. VPN mode reuses the HTTP Toolkit companion APK (`tech.httptoolkit.android.v1`, downloaded from GitHub releases by `apk-manager.ts`) and activates it with an intent that carries the proxy address and CA fingerprint. The proxy answers the companion's verification URLs with our CA.
- **iOS** is semi-automatic: the device is detected over usbmux, and the user follows setup steps and installs a `.mobileconfig` CA profile.

### UI

The UI uses Tailwind v4 + shadcn/ui (`components/ui/`, config in `components.json`, the `@/` alias → `src/renderer/src`), in-house primitives in `components/primitives/`, Monaco for the code and diff views, and a dark theme by default. The README's mention of styled-components is outdated. Path aliases are `@shared`, `@renderer` and `@`, defined in both `electron.vite.config.ts` and `vitest.config.ts`.
