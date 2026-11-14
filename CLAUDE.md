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

**Proxy lifecycle (no explicit start button):** the proxy is an implementation detail. `useProxyActions.ensureProxy` (in-flight deduped) starts it when something needs it: a device interception (`DevicePanel.handleStart`), switching to mock mode, or opening a Wi-Fi/iOS tab of the connection guide. If the port isn't specified, `ProxyService.start` tries 8080, 8081, … (10 tries) on `EADDRINUSE` and the UI says which port was used; an explicit port (status-bar panel `ProxyPanel`) fails instead of silently moving. Failures toast with a "다시 시도" action. The only manual controls are the status bar's proxy button → `ProxyPanel` (port, restart, stop, address for devices) and the palette commands. The sidebar's `CaptureControls` only pauses/resumes recording (`useCapture.paused` drops new `request` events; traffic still passes through) and clears. Stopping the proxy cuts the network of intercepted devices, so it stays out of the primary UI.

Applying or clearing mocks calls `server.reset()` and then re-registers the subscriptions, the companion endpoints, the mock rules and the unmatched rule, in that order. Mock hits are tracked through the rule id → mock id map (`ruleToMock`).

### Mocks, scenarios and projects

- **Mocks vs scenarios (product direction):** a *mock* (`MockDefinition`) is the ad-hoc, in-memory workspace rule (method + **host** + path matcher; `host` is required for new mocks and cloned from the captured URL, and `''` only appears for files saved before hosts existed, where it matches every host and the editor refuses to save until a host is entered; library endpoint ids are `METHOD host/path`, or `METHOD /path` for legacy `''`, editable response, `delayMs`, `fault` of `timeout|reset|close`, `originalBody` for the diff) that is applied to the proxy in mock mode. A *scenario* is the reusable, persisted layer for edge cases. Scenarios do **not** copy mocks: `shared/scenario-library.ts` holds a per-project **case library** (`library.json`: endpoints `METHOD /path` → named response cases such as 정상/500/타임아웃) and `ScenarioV2` (`picks` of endpoint → case, optional `base` scenario to inherit, `null` pick = switch an inherited endpoint off). `resolveScenario` turns a scenario into `MockDefinition[]` (with `caseRef`), so the proxy engine is unchanged; `diffWorkspace` drives the "수정됨" badge; `scenarioFromWorkspace`/`applyMockToCase` promote workspace mocks into cases. v1 scenario files (embedded mocks) are converted deterministically by `normalizeScenarios` when a project opens (originals kept as `scenarios/<name>.v1.bak`). Renderer state lives in `useScenarioLibrary`. All of this is edited in the **목킹** Rail section (`components/mock/MockingView.tsx`, full-width, panels stay mounted when hidden) with inner tabs 현재 목 (`MockPanel`) / 시나리오 (`ScenarioPanel`, or `ScenarioEditor` while editing). There is no separate 응답 케이스 screen (`LibraryModal` was removed): in `ScenarioEditor` each endpoint row shows the chosen case (name + status badge) and a `⋯` button (`useContextMenu`, Bruno-style, no select boxes) whose menu picks a case and, via `onCommitLibrary` (= `useScenarioLibrary.commit`), adds an edge-case preset (`addPresetCase`, auto-selected), edits (`MockEditor` with `lockEndpoint`) or deletes (`removeCase`, with a confirm listing affected scenarios) the selected case (`MenuItem.separatorBefore`, scrollable menu); case changes persist immediately, the picks only on 저장; the Rail has four sections (기기 연결, 트래픽, 목킹, 컬렉션; the old 프로젝트 tree section was removed and a stored `project` section falls back to 트래픽); the workbench tabs (`lib/workbench.ts`) now only hold request details (`exchange`) in the Traffic section. The top bar's 캡처/목킹 segment became a **목 적용** switch (internal value is still `AppMode` `capture|mock`; palette: 목 적용 켜기/끄기); save actions without a project call `toastNoProject` (`lib/no-project.ts`, openers registered by `App`) which offers 프로젝트 만들기/열기; the scenario `base` selector is folded under 고급 in `ScenarioEditor`; traffic rows (flat list, and the host/endpoint/call rows of the grouped list) have a `⋯` button (`RowMenuButton`) that opens the same menu as right-click; a response that hasn't arrived yet shows a `대기` badge (not `…`, which looked like that button). UI terms: 현재 목 = in-memory workspace mocks, 응답 케이스 = case library, 저장된 캡처 = capture sessions. Mocks are converted to mockttp serialized rules; methods are mockttp's numeric enum (`METHOD_ENUM`).
- **Collection** (Rail → 컬렉션, `components/collection/CollectionView.tsx`, full-width like the device view; both stay mounted when hidden) replaced the old "계약 테스트" modal/tab. It lists saved requests as folders per captured server, edits method/URL/headers/body, and sends one request to the real server (`window.mokerApi.contract.send` → `ProxyService.sendRequest` → worker `sendRequest` in `main/contract/contract-runner.ts`, plain Node so the corporate CA setting applies) showing status/time/size/headers/body. Tokens are entered per send and never stored; non-GET and production-looking servers ask for confirmation. Requests are still stored as `Contract` files in the project's `contracts/` folder plus `contract-servers.json` (the batch runner `contract:run` and `checkResponse` were removed; shape inference/validation stays in `shared/contract.ts` only because Bruno export/import uses it); Bruno import/export (`shared/bruno.ts`) is only in the collection toolbar, and traffic rows get "컬렉션에 추가" in the right-click menu. Pure helpers are in `renderer/lib/collection.ts`.
- **Traffic source (live vs saved captures):** `useCapture` keeps the live list (`liveExchanges`, always accumulating, paused only by `paused`) separate from an optional saved capture being viewed (`view: live | saved`, `viewSaved`/`backToLive`); `exchanges` is whatever is currently displayed, and filters, selection, clone-to-mock and collection-add all act on it, while saving ("실시간 목록 저장", auto-named `session-YYYYMMDD-HHMMSS` into the project's `captures/` folder), clearing, connected-client aggregation (`useClients(liveExchanges, …)`) always use the live list. The traffic panel header button is the source picker (실시간 ▾ / 저장된 캡처 보기: name / 실시간 목록 저장·비우기, built by `lib/traffic-menu.ts` `buildSourceMenu`, also on right-click of empty list space); while viewing a saved capture a banner shows "실시간으로 돌아가기" and the count of new live requests. Request-row right-click menu (`buildRowMenu`: clone to mock, add to collection, copy URL/cURL, filter by host/device; acts on the checked set when the clicked row is checked). The project name and 새 프로젝트/열기 live in the top nav (`TopBar`); there is no project bar and no project tree.
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

**Astryx (incremental migration in progress):** `@astryxdesign/core` + `theme-neutral` (needs React 19, so the app is on React 19; use `React.JSX.Element`, there is no global `JSX`). The frame is migrated (below); screens and shared primitives still use shadcn/Radix. Rules that must hold: (1) `styles/globals.css` declares `@layer reset, theme, base, astryx-base, astryx-theme, components, utilities;` **above** `@import 'tailwindcss'` and is the first import in `main.tsx`; putting it below makes the Astryx reset silently override every Tailwind utility. (2) The app is wrapped in `<Theme theme={evermockTheme} mode="dark">` from `renderer/src/theme/astryx-theme.ts`, which re-exports the **built** theme (`evermock.js/.css/.d.ts`, generated from `evermock.source.ts`: `neutral` extended with the bundled DM Sans / DM Mono, and the Astryx background/border/text/accent tokens pointed at our `hsl(var(--…))` palette variables so Astryx chrome matches the shadcn UI). After editing `evermock.source.ts` or upgrading Astryx run `npm run theme:build` and commit the outputs (`npm run theme:check` verifies; a runtime-injected theme logs a warning and breaks under jsdom). Do **not** import `@astryxdesign/theme-neutral/fonts.css` or run `astryx theme add` to generate `src/astryx-themes.ts`: it loads Figtree from Google Fonts, and this is an offline desktop app. (3) Our `@theme` block stays `inline`: `--color-accent/border/success/warning` collide with Astryx tokens, and `inline` keeps our Tailwind utilities (`bg-accent` = muted surface) on our values. (4) Astryx components ship precompiled, so no StyleX build plugin is needed (only for `astryx swizzle`). Migration order and mappings: `npx astryx docs migration`. **Frame:** `components/layout/AppFrame.tsx` composes Astryx `AppShell` (`variant="section"`, `mobileNav={false}`, desktop only) with `topNav` = `TopBar` (Astryx `TopNav`: logo, 목 적용 `Switch`, project name + new/open, CA; the 2 px bottom line is warning-colored while mocks are applied) and `sideNav` = `SectionNav` (Astryx `SideNav` + `SideNavItem`, icon-only by default, toggle expands labels; replaced `Rail`). AppShell owns the single `<main>`; the full-view sections are `<section aria-label>` (role `region`) and the status bar is the last row inside the content. Window chrome (drag region, macOS traffic-light inset, Windows control inset) is plain CSS on `.astryx-top-nav` at the end of `globals.css` (`data-platform` comes from preload); verified on macOS in a real Electron window (computed `drag` on the nav, `no-drag` on controls, window dragging works); still unverified on Windows, including `titleBarOverlay` height 46 / color `#181825` in `main/index.ts`, which must track the TopNav height. A plain browser cannot check this (it reports every `app-region` as `no-drag`).

<!-- ASTRYX:START -->
Astryx v0.7.15 · 174 components
CLI: run every command as `npx astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — start every page from a template, never from scratch:
1. `astryx build "<idea>"` — names the template to scaffold from and the parts it lacks.
2. `astryx template <name> <path>` — scaffold it; keep its frame, gap and padding; replace the content.
3. `astryx template <Block>` for parts it lacks; `astryx component <Name>` to read props before using one.
Changing an existing page? Keep it: skip step 2 and add blocks/components inside its sections.
Before you deliver a build, run `astryx doctor --built <dir>`; don't deliver it if it fails.

RULES:
- No <div> — components handle all layout and spacing.
- Read `astryx docs layout` before changing a template's frame.
- Dense data = rows (Table, List/Item), not Card-wrapped lists. Badge = counts only.
- Style with component props first, then Tailwind utilities backed by tokens. No raw hex/px.
- Palettes and custom colors go through the theme, never :root overrides. Run `astryx theme add <slug>` to import; `theme eject <slug>` only forks source. See `astryx docs theme`.
- SELF-CHECK: re-read the file; replace any style={{…}}, raw <div>/<span>, imported .css/@apply, or hardcoded/arbitrary value (bg-[#fff], p-[13px]) with the component or a token-backed utility.

`astryx help` lists every command. Key ones beyond the workflow:
  search "<query>"   find any component / hook / doc / template
  discover <words>   integrations you could add
  docs <topic>       getting-started, principles, tokens, theme … (`astryx docs` lists all)
  docs cli           commands and API reference
  docs authoring     build an integration package, and every field it holds
  upgrade --from <old version> --apply   run after a dependency bump
<!-- ASTRYX:END -->
