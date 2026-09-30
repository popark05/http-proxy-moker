/**
 * 프록시 워커를 의존성까지 모두 포함한 단일 CommonJS 파일(out/main/proxy-worker.cjs)로 번들한다.
 *
 * 배경: 워커는 번들된 순정 Node(OpenSSL)로 실행되는데, 순정 Node는 app.asar 안을 읽지 못한다.
 * 그래서 설치된 앱(repo 밖)에서 워커가 `import 'mockttp'`를 하면 ERR_MODULE_NOT_FOUND로 죽는다
 * (repo 안의 release/에서는 상위의 repo node_modules를 찾아서 동작하는 것처럼 보였다).
 * 의존성을 모두 번들하면 워커는 node_modules 없이 실행되고, app.asar.unpacked에 이 파일과
 * 아래 런타임 자산만 풀어 두면 된다(macOS·Windows 공통).
 *
 * CommonJS로 내는 이유: 번들된 서드파티가 쓰는 __dirname이 그대로 동작하고, Node 버전별
 * ESM 자동 감지(.js + package.json 없음)에 의존하지 않는다.
 *
 * 런타임 자산: 번들 안에서 __dirname 기준으로 파일을 읽는 모듈은 그 파일을 워커 옆에 복사해야 한다.
 * mockttp 의존성 187개를 조사한 결과 해당하는 것은 brotli-wasm(pkg.node/brotli_wasm_bg.wasm)뿐이다
 * (zstd-codec, quickjs-emscripten은 wasm을 JS에 내장). 단, http-encoding은 Node 내장 zlib에
 * brotli(Node 11.7+)·zstd(Node 22.15/23.8+)가 있으면 그것을 쓰므로, 고정한 번들 Node에서는
 * brotli-wasm이 실제로 로드되지 않는다 — 구버전 Node 대비 안전장치로만 복사한다.
 * 새 의존성이 파일을 읽으면 아래 검사가 빌드를 실패시킨다.
 *
 * 사용: electron.vite.config.ts의 플러그인이 main 빌드 후 호출한다. 단독 실행도 가능:
 *   node scripts/build-proxy-worker.mjs
 */
import * as esbuild from 'esbuild';
import { copyFile, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const WORKER_ENTRY = path.join(root, 'src/main/proxy/proxy-worker-entry.ts');
export const WORKER_FILE = 'proxy-worker.cjs';

/** 번들 안에서 __dirname 기준으로 읽히는 파일: [번들 입력 경로 패턴, 복사할 파일(입력 기준 상대)]. */
const RUNTIME_ASSETS = [[/brotli-wasm[\\/]pkg\.node[\\/]brotli_wasm\.js$/, 'brotli_wasm_bg.wasm']];

/**
 * __dirname과 wasm/파일 읽기 코드가 함께 있지만 실제로는 파일을 읽지 않는 모듈(검증함).
 * Emscripten 보일러플레이트(scriptDirectory = __dirname + "/")만 있고 wasm은 JS에 내장돼 있다.
 */
const KNOWN_EMBEDDED = [
  /zstd-codec[\\/]lib[\\/]zstd-codec-binding(-wasm)?\.js$/,
  /@tootallnate[\\/]quickjs-emscripten[\\/]dist[\\/]generated[\\/]emscripten-module\.WASM_RELEASE_SYNC\.js$/
];

function options(outDir) {
  return {
    entryPoints: [WORKER_ENTRY],
    outfile: path.join(outDir, WORKER_FILE),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    // @shared/* 경로 별칭.
    tsconfig: path.join(root, 'tsconfig.node.json'),
    metafile: true,
    logLevel: 'warning',
    // ws의 선택적 가속 모듈(설치 안 됨): try/catch로 감싼 require라 없으면 JS 구현을 쓴다.
    external: ['bufferutil', 'utf-8-validate']
  };
}

/** 번들 결과에서 런타임 자산을 찾아 워커 옆에 복사하고, 처리 안 된 파일 읽기가 있으면 실패시킨다. */
async function copyRuntimeAssets(metafile, outDir) {
  const inputs = Object.keys(metafile.inputs).map((p) => path.resolve(root, p));
  const copied = [];
  for (const [pattern, asset] of RUNTIME_ASSETS) {
    for (const input of inputs.filter((p) => pattern.test(p))) {
      await copyFile(path.join(path.dirname(input), asset), path.join(outDir, asset));
      copied.push(asset);
    }
  }

  // 안전장치: __dirname과 파일 읽기/wasm/네이티브 로드가 함께 있는 모듈이 새로 들어오면 빌드를 실패시킨다.
  const known = (p) =>
    RUNTIME_ASSETS.some(([pattern]) => pattern.test(p)) || KNOWN_EMBEDDED.some((pattern) => pattern.test(p));
  const suspicious = [];
  for (const input of inputs) {
    if (known(input) || !/node_modules/.test(input) || !/\.(c|m)?js$/.test(input)) continue;
    const source = await readFile(input, 'utf-8');
    if (/__dirname/.test(source) && /readFileSync|readFile\(|\.wasm['"]|\.node['"]|require\.resolve/.test(source)) {
      suspicious.push(path.relative(root, input));
    }
  }
  if (suspicious.length > 0) {
    throw new Error(
      `프록시 워커 번들에 __dirname 기준 파일 읽기가 있습니다. 설치된 앱에서 파일을 못 찾을 수 있으니 ` +
        `scripts/build-proxy-worker.mjs의 RUNTIME_ASSETS에 추가하세요:\n  ${suspicious.join('\n  ')}`
    );
  }
  return copied;
}

export async function buildProxyWorker(outDir = path.join(root, 'out/main')) {
  const result = await esbuild.build(options(outDir));
  return copyRuntimeAssets(result.metafile, outDir);
}

/** 개발 모드: 워커 소스가 바뀌면 다시 번들한다(실행 중인 워커는 앱 재시작/프록시 재시작 시 반영). */
export async function watchProxyWorker(outDir) {
  const ctx = await esbuild.context({
    ...options(outDir),
    plugins: [
      {
        name: 'copy-runtime-assets',
        setup(build) {
          build.onEnd(async (result) => {
            if (result.errors.length === 0 && result.metafile) await copyRuntimeAssets(result.metafile, outDir);
          });
        }
      }
    ]
  });
  await ctx.watch();
  return ctx;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const copied = await buildProxyWorker();
  console.log(`[ok] out/main/${WORKER_FILE} (+ ${copied.join(', ') || '자산 없음'})`);
}
