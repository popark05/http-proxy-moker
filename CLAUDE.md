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
EVERMOCK_ADB_TRACE=1 npm run dev 2>&1 | tee /tmp/evermock-adb.log   # packet/proxy trace on one time axis (see "Direct ADB layer")
EVERMOCK_ADB=server npm run dev                   # control run: skip direct USB, use only the running adb server
```

Tests live in `test/{main,renderer,shared}` and mirror `src/`. The default environment is jsdom. Tests that use real sockets or mockttp (for example `https-capture`) start with `// @vitest-environment node`.

### Building behind corporate SSL interception (사내망)

If `npm install` fails to download the Electron binary (`Error: Electron uninstall`), Node's TLS verification doesn't trust the intercepting proxy's CA. `.npmrc` `cafile` only covers npm registry traffic, so also set `NODE_EXTRA_CA_CERTS` to the CA bundle (PEM, HMG Secure ROOT CA + Zscaler) in the same shell:

```bash
export NODE_EXTRA_CA_CERTS=$HOME/.certs/all-system-certs.pem
npm install
npm run dist:mac     # → release/EverMock-0.1.0-mac-{arm64,x64}.dmg
```

- The same variable is needed for `dist:mac`/`dist:win`: `fetch-node`, `fetch-usb` and electron-builder's Electron download are plain Node HTTPS calls.
- Use the bundle, not the HMG root CA alone: the network also uses Zscaler, and the HMG root CA by itself fails with `self-signed certificate in certificate chain` during electron-builder's download.
- Electron zips are cached in `~/Library/Caches/electron`, so a cached version doesn't need a re-download.
- Builds are unsigned (`identity: null`), so the DMG needs the usual Gatekeeper bypass on first launch.
- At runtime the companion APK download (`ApkManager`) uses Electron's `net.fetch` (system certificate store) because Node `fetch` does not trust the interception CA.

## Architecture

It's a three-process Electron app plus a separate **proxy worker** process:

- **`src/main/`**: the Electron main process. `index.ts` creates the window, and `ipc-handlers.ts` wires every service (`ProxyService`, `CaManager`, `DeviceService` with Android/iOS connectors, `ProjectStore`) to `ipcMain.handle` channels.
- **`src/preload/`**: exposes `window.mokerApi` through contextBridge. It's built as **CJS (`index.cjs`)** because `package.json` has `"type": "module"`.
- **`src/renderer/`**: the React UI. State lives in hooks under `state/` (`useCapture`, `useMocks`, `useProject`, `useTrafficFilter`, `useMockHits`, and the `app-mode` context: `'capture' | 'mock'`). `App.tsx` coordinates them. For example, an effect re-applies mocks to the proxy whenever the mode, the mocks or the unmatched policy change.
- **`src/shared/`**: types and pure logic shared by main and renderer. `ipc.ts` is the single IPC contract (the `IpcChannels` names plus the `MokerApi` interface). Adding an IPC call means touching `shared/ipc.ts`, `preload/index.ts` and `main/ipc-handlers.ts` together. Slow start/stop operations (proxy, device interception) report their current step through an optional `ProgressReporter` (`shared/progress.ts`; `ProxyService.start/stop`, `InterceptionOptions.report`, `DeviceConnector.stopInterception`), pushed to the renderer on `operationProgress` and shown by `withProgress` (`renderer/state/with-progress.ts`) as a loading toast, while the buttons switch to disabled "시작 중…/중지 중…/연결 중…/해제 중…" states. Pure logic (HAR conversion, capture→mock conversion, traffic filtering) lives here so it can be unit-tested.

### Proxy worker (important)

mockttp's upstream TLS breaks under Electron's BoringSSL (`INVALID_COMMAND`, which makes HTTPS passthrough return 500). The proxy therefore runs in a **separate plain-Node (OpenSSL) child process**:

- `main/proxy/proxy-engine.ts` (`ProxyEngine`): the actual mockttp logic, covering start/stop, mock rule injection, capture subscription and the companion-VPN verification endpoints. Tests instantiate it directly.
- `main/proxy/proxy-worker-entry.ts`: the worker entry point. `scripts/build-proxy-worker.mjs` (run by a plugin in `electron.vite.config.ts` after the main build, watched in dev) bundles it with esbuild into **one self-contained CommonJS file, `out/main/proxy-worker.cjs`, including `mockttp` and all its dependencies**. This is required because plain Node can't read `app.asar`: an external `import 'mockttp'` only appeared to work from `release/` inside the repo. The build copies the one runtime file asset (`brotli_wasm_bg.wasm`, a fallback only) next to it and fails if a new dependency reads files via `__dirname`. `test/main/proxy-worker-bundle.test.ts` guards this.
- `main/proxy/proxy-service.ts` (`ProxyService`): runs in main. It forks the worker with a real Node binary and talks to it over the `WorkerCommand`/`WorkerMessage` protocol (`shared/proxy-worker.ts`, matched by requestId, with plain structured-cloneable data only). It then relays capture events to the renderer.
- The worker's Node is **pinned** (`NODE_VERSION` in `scripts/fetch-node.mjs`, SHA-256 verified, LICENSE included), stored per target in `resources/node/<mac|win>-<arch>/` and packaged via `extraResources` (`${os}-${arch}` → `<resources>/node/<arch>/node(.exe)`). Resolution: `NODE_BINARY_PATH` → bundled Node (an installed app errors out if it's missing rather than using the user's Node) → dev only: the repo's pinned Node, then system node. In packaged builds the worker and `*.wasm` are `asarUnpack`ed, and the path is rewritten to `app.asar.unpacked`.
- Every change must keep **installed macOS and Windows builds** working, not just dev. Verify packaging-sensitive changes against a packaged app copied outside the repo.

Applying or clearing mocks calls `server.reset()` and then re-registers the subscriptions, the companion endpoints, the mock rules and the unmatched rule, in that order. Mock hits are tracked through the rule id → mock id map (`ruleToMock`).

### Mocks, scenarios and projects

- **Mocks vs scenarios (product direction):** a *mock* (`MockDefinition`) is the ad-hoc, in-memory workspace rule (method + path matcher, editable response, `delayMs`, `fault` of `timeout|reset|close`, `originalBody` for the diff) that is applied to the proxy in mock mode. A *scenario* is the reusable, persisted layer for edge cases. Scenarios do **not** copy mocks: `shared/scenario-library.ts` holds a per-project **case library** (`library.json`: endpoints `METHOD /path` → named response cases such as 정상/500/타임아웃) and `ScenarioV2` (`picks` of endpoint → case, optional `base` scenario to inherit, `null` pick = switch an inherited endpoint off). `resolveScenario` turns a scenario into `MockDefinition[]` (with `caseRef`), so the proxy engine is unchanged; `diffWorkspace` drives the "수정됨" badge; `scenarioFromWorkspace`/`applyMockToCase` promote workspace mocks into cases. v1 scenario files (embedded mocks) are converted deterministically by `normalizeScenarios` when a project opens (originals kept as `scenarios/<name>.v1.bak`). Renderer state lives in `useScenarioLibrary`; UI in `ScenarioPanel`, `ScenarioEditor`, `LibraryModal`. Mocks are converted to mockttp serialized rules; methods are mockttp's numeric enum (`METHOD_ENUM`).
- A project is a local directory: `project.json`, `library.json`, `captures/<name>.har.json` (HAR 1.2 with extensions such as `_tags`), and `scenarios/<name>.json`.

### Connected clients (proxy-observed devices)

Devices are also identified by what the proxy actually sees, not only by transport (adb/usbmux), so Wi-Fi-proxy devices (manual iOS setup, Android over Wi-Fi) show up. `ProxyEngine` records the client IP on every request (`CapturedRequest.clientIp`, normalized by `normalizeClientIp`; saved in HAR as `_clientIp`) and forwards mockttp `tls-client-error` as a `tls-error` capture event. `shared/clients.ts` aggregates exchanges + TLS errors per IP (`aggregateClients`: platform/model/OS from the User-Agent heuristics, request/HTTPS counts, last seen), derives `clientState` (`untrusted` = TLS failures with zero decrypted HTTPS, i.e. the device does not trust the CA; `active` within 15 s; else `idle`) and `clientLabel`. The UI (`ClientList` in the device panel, `useClients`) shows this list, a per-device filter (`TrafficFilter.client`) and device icons in the flat traffic list. Android over USB (`adb reverse`/VPN companion) all arrive from `127.0.0.1`, so several USB Androids cannot be told apart without per-device proxy ports (not implemented).

### Devices

`main/device/device-connector.ts` defines the `DeviceConnector` interface, implemented by `android/android-connector.ts` and `ios/ios-connector.ts` and aggregated by `DeviceService`. Hardware access goes through thin interfaces (`adb-client.ts` and `usbmux-client.ts`, with adapters `direct-adb-adapter.ts` and `usbmux-adapter.ts`) so tests can inject fakes.

- **Android** is fully automatic. The modes are `auto`, `system CA (root)` and `VPN (non-root)`. The traffic path is a separate choice (`InterceptionOptions.trafficPath`): `usb` (default; `adb reverse` tunnel, the device talks to `127.0.0.1:<port>`) or `wifi` (no tunnel, an existing reverse rule is removed and the device uses the PC's LAN IP, so each device shows up under its own IP). Once started, `useDevices` re-checks Android interceptions every 5 s through `DeviceConnector.checkInterception` (VPN: the companion's `ProxyVpnService` record in `dumpsys activity services`; root: `settings get global http_proxy`) and drops one from the active list with a warning toast when it was seen active and then reports inactive twice in a row (`shared/interception-liveness.ts`: never before the first active sighting, because the VPN permission prompt keeps it inactive; check errors are `unknown` and change nothing). This is how a manual Disconnect inside the companion app shows up, since the app's own broadcasts are not observable over adb. A failed start (`interceptionStarted` in `useDevices.ts`: Android needs `proxyConfigured`) is reported with a warning toast and is not stored as an active interception. VPN mode reuses the HTTP Toolkit companion APK (`tech.httptoolkit.android.v1`, downloaded from GitHub releases by `apk-manager.ts`) and activates it with an intent that carries the proxy address and CA fingerprint. The proxy answers the companion's verification URLs with our CA.
- **iOS** is semi-automatic: the device is detected over usbmux, and the user follows setup steps and installs a `.mobileconfig` CA profile.
- **Connection wizard** (`components/device/ConnectionWizard.tsx`, `ConnectionScene.tsx`; hairline figures themed by `.hairline-theme`): tabs Android·USB, Android·Wi-Fi (USB control + Wi-Fi traffic, or manual proxy) and iPhone·Wi-Fi. Step state comes from the pure `shared/connection-progress.ts` (`connectionProgress`), which derives done/current/blocked from proxy status, device list, interception results and the connected-clients list; manual steps count as done when a later step has evidence.

### Direct ADB layer (`src/main/adb`, used by the app via `main/device/direct-adb-adapter.ts`)

A TypeScript port of dadb (Apache-2.0, see `src/main/adb/NOTICE`) that replaces the adb binary (adbkit has been removed; no adb install is needed). `createDirectAdbClient` (the `AdbClient` implementation `AndroidConnector` uses) caches one `Dadb` per serial, probes connections to report `device`/`unauthorized`/`offline` + `statusDetail` in the device list, and is what `ipc-handlers.ts` registers. `Dadb` is the entry point: `fromUsb(serial)` (node-usb, WebUSB API), `fromEmulator(port)`, `create(host, port)`, `fromAdbServer(serial)`, and `list()`. Services (shell v2, sync push/pull, install, reverse, tcpForward, root) are written against `AdbSession`/`AdbStreamLike` (`protocol/session.ts`), so they run unchanged over a direct connection or a running adb server. The adb-server path is **opt-in** (`adbServerFallback: true` / `includeAdbServer: true`, both default `false`) so that development always exercises the direct layer; with it off, an unclaimable USB interface throws `AdbUsbAccessException` (adb server/Android Studio holds it, or a non-WinUSB driver on Windows). When on, `fromUsb` falls back to the adb server at `127.0.0.1:${ANDROID_ADB_SERVER_PORT:-5037}` and retries direct on every reconnect (`dadb.connectionKind` tells which path is in use). Transport failures throw `AdbException` subclasses; operation outcomes are returned as `*Result` values. USB binaries per target come from `npm run fetch-usb` (a plain `npm install` prunes the non-host ones). The fakes in `test/main/adb/` (`fake-android`, `fake-usb`, `fake-adb-server`) reproduce real adbd/node-usb/adb-server behavior.

**Reverse/forward relay rule (`services/forward.ts`, `pipeSocketAndStream`).** The socket→device half must read eagerly and write to the device through an ordered queue, and send CLSE only after everything received has been written (or after `FLUSH_TIMEOUT_MS` if the device never acks, or immediately if a write fails). Pausing the socket on every chunk until the device's OKAY looks like backpressure but loses data: bytes still in the kernel buffer are dropped when the proxy closes (FIN/RST), so the final TLS record (the chunked terminator `0\r\n\r\n`) never reaches the device and the webview renders blank ("백화"). This showed up only on the direct-USB layer, never with the real adb server (which reads eagerly). Regression tests are in `test/main/adb/reverse.test.ts` (manual-ack fake device, FIN and RST variants, 48 concurrent connections). Do not reintroduce per-chunk `socket.pause()`.

**Diagnostics (all off by default).** `EVERMOCK_ADB_TRACE=1` prints `[adb HH:MM:SS.mmm] ...` (UTC) lines: every packet in/out (`protocol/packet-io.ts`: `<- CMD[arg0, arg1] len=N`, `-> CMD[...]`), the open-stream count every 5 s (`protocol/connection.ts`) and the proxy's `req|res|abort <id8>` lines (`proxy-engine.ts`, the worker inherits the env), all through `src/main/adb/trace.ts`. A truncated response shows up as `-> WRTE` of the last bytes missing before `-> CLSE`. `EVERMOCK_ADB=server` (`createDirectAdbClient({ adbServerOnly })`) skips direct USB/emulator discovery and uses only the running adb server, as a control run; run `adb kill-server` before testing the direct path so the server doesn't hold the USB interface.

### UI

The UI uses Tailwind v4 + shadcn/ui (`components/ui/`, config in `components.json`, the `@/` alias → `src/renderer/src`), in-house primitives in `components/primitives/`, Monaco for the code and diff views, and a dark theme by default. The README's mention of styled-components is outdated. Path aliases are `@shared`, `@renderer` and `@`, defined in both `electron.vite.config.ts` and `vitest.config.ts`.
