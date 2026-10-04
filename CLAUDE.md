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
npm run dist:mac       # fetch-node + fetch-usb + build + electron-builder DMG (arm64/x64) → release/
npm run fetch-usb      # node-usb binaries per target into node_modules/@node-usb (`-- --targets all` for cross builds)
npm run fetch-node     # pinned Node for the proxy worker → resources/node/<mac|win>-<arch>/ (`-- --targets all` for cross builds)
npm run verify:worker  # bundle the worker outside the repo, fork it with the pinned Node, check capture + gzip/br/zstd decoding
node scripts/verify-worker-bundle.mjs --resources <installed app resources dir>   # same check against a packaged/installed app
node scripts/verify-vpn.mjs <deviceId>           # real-device Android VPN capture check
ADB_TEST_USB=1 npx vitest run test/main/adb/usb-device.test.ts   # real-device direct-USB ADB check (run `adb kill-server` first)
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
- `main/proxy/proxy-worker-entry.ts`: the worker entry point. `scripts/build-proxy-worker.mjs` (run by a plugin in `electron.vite.config.ts` after the main build, watched in dev) bundles it with esbuild into **one self-contained CommonJS file, `out/main/proxy-worker.cjs`, including `mockttp` and all its dependencies**. This is required because plain Node can't read `app.asar`: an external `import 'mockttp'` only appeared to work from `release/` inside the repo. The build copies the one runtime file asset (`brotli_wasm_bg.wasm`, a fallback only) next to it and fails if a new dependency reads files via `__dirname`. `test/main/proxy-worker-bundle.test.ts` guards this.
- `main/proxy/proxy-service.ts` (`ProxyService`): runs in main. It forks the worker with a real Node binary and talks to it over the `WorkerCommand`/`WorkerMessage` protocol (`shared/proxy-worker.ts`, matched by requestId, with plain structured-cloneable data only). It then relays capture events to the renderer.
- The worker's Node is **pinned** (`NODE_VERSION` in `scripts/fetch-node.mjs`, SHA-256 verified, LICENSE included), stored per target in `resources/node/<mac|win>-<arch>/` and packaged via `extraResources` (`${os}-${arch}` → `<resources>/node/<arch>/node(.exe)`). Resolution: `NODE_BINARY_PATH` → bundled Node (an installed app errors out if it's missing rather than using the user's Node) → dev only: the repo's pinned Node, then system node. In packaged builds the worker and `*.wasm` are `asarUnpack`ed, and the path is rewritten to `app.asar.unpacked`.
- Every change must keep **installed macOS and Windows builds** working, not just dev. Verify packaging-sensitive changes against a packaged app copied outside the repo.

Applying or clearing mocks calls `server.reset()` and then re-registers the subscriptions, the companion endpoints, the mock rules and the unmatched rule, in that order. Mock hits are tracked through the rule id → mock id map (`ruleToMock`).

### Mocks and projects

- `shared/mock.ts`: `MockDefinition` (method + path matcher, editable response, `delayMs`, `fault` of `timeout|reset|close`, and `originalBody` for the edited-vs-original diff) and `MockScenario`. Mocks are converted to mockttp serialized rules; methods are mockttp's numeric enum (`METHOD_ENUM`).
- A project is a local directory: `project.json`, `captures/<name>.har.json` (HAR 1.2 with extensions such as `_tags`), and `scenarios/<name>.json`.

### Devices

`main/device/device-connector.ts` defines the `DeviceConnector` interface, implemented by `android/android-connector.ts` and `ios/ios-connector.ts` and aggregated by `DeviceService`. Hardware access goes through thin interfaces (`adb-client.ts` and `usbmux-client.ts`, with adapters `adbkit-adapter.ts` and `usbmux-adapter.ts`) so tests can inject fakes.

- **Android** is fully automatic. The modes are `auto`, `system CA (root)` and `VPN (non-root)`. VPN mode reuses the HTTP Toolkit companion APK (`tech.httptoolkit.android.v1`, downloaded from GitHub releases by `apk-manager.ts`) and activates it with an intent that carries the proxy address and CA fingerprint. The proxy answers the companion's verification URLs with our CA.
- **iOS** is semi-automatic: the device is detected over usbmux, and the user follows setup steps and installs a `.mobileconfig` CA profile.

### Direct ADB layer (`src/main/adb`, used by the app via `main/device/direct-adb-adapter.ts`)

A TypeScript port of dadb (Apache-2.0, see `src/main/adb/NOTICE`) that replaces the adb binary/adbkit. `createDirectAdbClient` (the `AdbClient` implementation `AndroidConnector` uses) caches one `Dadb` per serial, probes connections to report `device`/`unauthorized`/`offline` + `statusDetail` in the device list, and is the default in `ipc-handlers.ts`; `MOKER_ADB_BACKEND=adbkit` switches back to the old adbkit adapter until it is removed. `Dadb` is the entry point: `fromUsb(serial)` (node-usb, WebUSB API), `fromEmulator(port)`, `create(host, port)`, `fromAdbServer(serial)`, and `list()`. Services (shell v2, sync push/pull, install, reverse, tcpForward, root) are written against `AdbSession`/`AdbStreamLike` (`protocol/session.ts`), so they run unchanged over a direct connection or a running adb server. The adb-server path is **opt-in** (`adbServerFallback: true` / `includeAdbServer: true`, both default `false`) so that development always exercises the direct layer; with it off, an unclaimable USB interface throws `AdbUsbAccessException` (adb server/Android Studio holds it, or a non-WinUSB driver on Windows). When on, `fromUsb` falls back to the adb server at `127.0.0.1:${ANDROID_ADB_SERVER_PORT:-5037}` and retries direct on every reconnect (`dadb.connectionKind` tells which path is in use). Transport failures throw `AdbException` subclasses; operation outcomes are returned as `*Result` values. USB binaries per target come from `npm run fetch-usb` (a plain `npm install` prunes the non-host ones). The fakes in `test/main/adb/` (`fake-android`, `fake-usb`, `fake-adb-server`) reproduce real adbd/node-usb/adb-server behavior.

### UI

The UI uses Tailwind v4 + shadcn/ui (`components/ui/`, config in `components.json`, the `@/` alias → `src/renderer/src`), in-house primitives in `components/primitives/`, Monaco for the code and diff views, and a dark theme by default. The README's mention of styled-components is outdated. Path aliases are `@shared`, `@renderer` and `@`, defined in both `electron.vite.config.ts` and `vitest.config.ts`.
