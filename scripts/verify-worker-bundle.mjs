/**
 * 번들된 프록시 워커가 "설치된 앱"처럼 node_modules 없이 동작하는지 검증한다(macOS·Windows 공통).
 *
 * 1. 워커를 repo 밖 임시 폴더에 번들한다(상위 경로에 node_modules가 없어 repo 의존성을 못 찾음).
 * 2. 앱에 번들되는 Node 바이너리로 fork하고, ProxyService와 같은 IPC 프로토콜로 프록시를 시작한다
 *    (CA 파일 로드 경로 포함).
 * 3. 로컬 서버가 gzip/brotli/zstd로 압축한 응답을 프록시로 받아, 캡처된 본문이 원문으로
 *    디코딩됐는지 확인한다(capture-mapper는 디코딩 실패 시 조용히 원본 바이트로 대체하므로
 *    내용 비교로만 드러난다). zstd는 Node 22.15/23.8+ 내장 zlib 또는 번들된 zstd-codec로 풀린다.
 *
 * 사용:
 *   node scripts/verify-worker-bundle.mjs [--node <node 경로>]
 *     새로 번들해 검증. 기본 Node: resources/node/<mac|win>-<arch>/node(.exe) (npm run fetch-node).
 *   node scripts/verify-worker-bundle.mjs --resources <설치된 앱의 resources 폴더>
 *     설치/패키징된 앱을 그대로 검증(빌드 안 함): <resources>/app.asar.unpacked/out/main/proxy-worker.cjs를
 *     <resources>/node/<arch>/node(.exe)로 실행한다.
 *       macOS:   /Applications/EverMock.app/Contents/Resources
 *       Windows: "C:\Program Files\EverMock\resources" (설치 위치에 따라 다름)
 */
import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { buildProxyWorker, WORKER_FILE } from './build-proxy-worker.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIMEOUT = 20_000;

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const EXE = process.platform === 'win32' ? 'node.exe' : 'node';

/** --resources 모드: 설치된 앱의 워커와 Node. */
function installedApp() {
  const resources = argValue('--resources');
  if (!resources) return undefined;
  const dir = path.resolve(resources);
  const worker = path.join(dir, 'app.asar.unpacked', 'out', 'main', WORKER_FILE);
  const node = path.join(dir, 'node', process.arch, EXE);
  for (const f of [worker, node]) if (!existsSync(f)) throw new Error(`설치본에 파일이 없습니다: ${f}`);
  return { worker, node };
}

function bundledNode() {
  const flag = process.argv.indexOf('--node');
  if (flag >= 0) return path.resolve(process.argv[flag + 1]);
  const osName = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : process.platform;
  const candidate = path.join(root, 'resources', 'node', `${osName}-${process.arch}`, EXE);
  if (existsSync(candidate)) return candidate;
  console.warn(`[warn] 번들 Node 없음(${candidate}) → 현재 Node로 검증. 먼저 npm run fetch-node를 권장.`);
  return process.execPath;
}

/** 압축 방식별로 같은 원문을 돌려주는 로컬 서버. */
function startOrigin(text) {
  const encoders = {
    identity: (b) => b,
    gzip: (b) => zlib.gzipSync(b),
    br: (b) => zlib.brotliCompressSync(b),
    zstd: zlib.zstdCompressSync ? (b) => zlib.zstdCompressSync(b) : undefined
  };
  const server = http.createServer((req, res) => {
    const encoding = req.url.slice(1);
    const body = encoders[encoding](Buffer.from(text, 'utf-8'));
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      ...(encoding !== 'identity' ? { 'content-encoding': encoding } : {})
    });
    res.end(body);
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        server,
        port: server.address().port,
        encodings: Object.keys(encoders).filter((k) => encoders[k])
      })
    )
  );
}

/** 프록시를 통해 GET(절대 URL 요청 = 일반 HTTP 프록시 방식). */
function getViaProxy(proxyPort, url) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, path: url, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const installed = installedApp();
  const nodePath = installed?.node ?? bundledNode();
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'evermock-worker-'));
  const outDir = path.join(workDir, 'app.asar.unpacked', 'out', 'main');
  const workerFile = installed?.worker ?? path.join(outDir, WORKER_FILE);
  let worker;
  let origin;
  try {
    if (installed) {
      console.log(`[installed] ${workerFile}`);
    } else {
      console.log(`[build] ${outDir}`);
      const assets = await buildProxyWorker(outDir);
      console.log(`[build] ${WORKER_FILE} + ${assets.join(', ')}`);
    }

    // CA 로드 경로도 실제와 같게: mockttp로 CA를 만들어 파일로 전달(repo 쪽 Node에서 생성).
    const { generateCACertificate } = await import('mockttp');
    const ca = await generateCACertificate({ subject: { commonName: 'EverMock verify CA' } });
    const certPath = path.join(workDir, 'ca.pem');
    const keyPath = path.join(workDir, 'ca.key');
    await writeFile(certPath, ca.cert);
    await writeFile(keyPath, ca.key);

    const text = JSON.stringify({ message: '안녕 EverMock', items: Array.from({ length: 50 }, (_, i) => i) });
    origin = await startOrigin(text);

    console.log(`[fork] ${nodePath}`);
    worker = fork(workerFile, [], {
      execPath: nodePath,
      cwd: workDir,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: '' },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc']
    });

    const responses = [];
    let nextId = 1;
    const pending = new Map();
    let readyResolve;
    const ready = new Promise((r) => (readyResolve = r));
    worker.on('message', (msg) => {
      if (msg.kind === 'ready') readyResolve();
      else if (msg.kind === 'result') pending.get(msg.requestId)?.(msg);
      else if (msg.kind === 'capture' && msg.event.type === 'response') responses.push(msg.event.response);
    });
    const exited = new Promise((_, reject) => {
      worker.on('exit', (code) => reject(new Error(`워커가 종료됨(code=${code}) — 번들/모듈 해석 실패 가능`)));
      worker.on('error', (e) => reject(new Error(`워커 실행 실패: ${e.message}`)));
    });
    const withTimeout = (p, label) =>
      Promise.race([p, exited, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} 시간 초과`)), TIMEOUT))]);
    const command = (cmd) =>
      withTimeout(
        new Promise((resolve) => {
          const requestId = nextId++;
          pending.set(requestId, resolve);
          worker.send({ ...cmd, requestId });
        }),
        cmd.kind
      );

    await withTimeout(ready, 'ready');
    const started = await command({ kind: 'start', port: 0, caCertPath: certPath, caKeyPath: keyPath });
    if (!started.ok) throw new Error(`프록시 시작 실패: ${started.error}`);
    const proxyPort = started.status.port;
    console.log(`[proxy] 127.0.0.1:${proxyPort}`);

    let failed = 0;
    for (const encoding of origin.encodings) {
      const before = responses.length;
      await withTimeout(getViaProxy(proxyPort, `http://127.0.0.1:${origin.port}/${encoding}`), encoding);
      const deadline = Date.now() + 5000;
      while (responses.length === before && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      const body = responses[before]?.body;
      const ok = body?.encoding === 'text' && body.content === text;
      if (!ok) failed++;
      console.log(`${ok ? '[ok]  ' : '[FAIL]'} ${encoding}: ${ok ? '원문으로 디코딩됨' : JSON.stringify(body)?.slice(0, 120)}`);
    }
    if (!origin.encodings.includes('zstd')) console.log('[skip] zstd: 검증용 Node에 zlib.zstdCompressSync 없음');

    await command({ kind: 'stop' });
    if (failed > 0) throw new Error(`${failed}개 인코딩 디코딩 실패`);
    console.log('[pass] 설치 환경과 같은 조건에서 워커 동작 확인');
  } finally {
    worker?.kill();
    origin?.server.close();
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('[fail]', e.message);
  process.exit(1);
});
