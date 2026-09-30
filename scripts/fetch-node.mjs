/**
 * 프록시 워커 실행용 Node 바이너리를 대상 플랫폼별로 받아 resources/node/<mac|win>-<arch>/ 에 둔다.
 *
 * 배경: 프록시 엔진(mockttp)은 OpenSSL Node에서만 업스트림 HTTPS가 동작한다(Electron 런타임의
 * BoringSSL에서는 INVALID_COMMAND). 그래서 설치본에 Node를 포함해, 사용자 PC에 Node가 없어도 동작한다.
 *
 * - 버전 고정: 빌드 머신의 Node 버전이 아니라 NODE_VERSION을 쓴다(설치본 동작이 빌드 환경에 좌우되지 않게).
 *   zstd 응답 디코딩은 Node 22.15/23.8+ 내장 zlib를 쓰므로 그 이상이어야 한다.
 * - 무결성: nodejs.org의 SHASUMS256.txt로 SHA-256을 검증한다.
 * - 라이선스: Node를 재배포하므로 LICENSE를 함께 둔다.
 * - macOS·Windows 빌드 머신 모두에서 실행 가능(압축 해제는 bsdtar: macOS 기본, Windows 10+ tar.exe가 zip 지원).
 *
 * 사용:
 *   node scripts/fetch-node.mjs                 # 현재 OS용 대상(mac: arm64+x64 / win: x64+arm64)
 *   node scripts/fetch-node.mjs --targets all   # 모든 대상(교차 빌드용)
 *   node scripts/fetch-node.mjs --targets win-x64,mac-arm64
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 설치본에 포함할 Node 버전(LTS). 올릴 때는 scripts/verify-worker-bundle.mjs로 검증한다. */
export const NODE_VERSION = '24.13.0';

const ALL_TARGETS = ['mac-arm64', 'mac-x64', 'win-x64', 'win-arm64'];
const HOST_TARGETS = {
  darwin: ['mac-arm64', 'mac-x64'],
  win32: ['win-x64', 'win-arm64']
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = path.join(root, 'resources', 'node');

function parseTargets() {
  const idx = process.argv.indexOf('--targets');
  const value = idx >= 0 ? process.argv[idx + 1] : undefined;
  if (!value) {
    const targets = HOST_TARGETS[process.platform];
    if (!targets) throw new Error(`지원하지 않는 빌드 호스트: ${process.platform} (--targets로 지정)`);
    return targets;
  }
  const targets = value === 'all' ? ALL_TARGETS : value.split(',').map((t) => t.trim());
  for (const t of targets) if (!ALL_TARGETS.includes(t)) throw new Error(`알 수 없는 대상: ${t}`);
  return targets;
}

/** 대상별 배포 파일과 압축 안의 경로. */
function distInfo(target) {
  const [osName, arch] = target.split('-');
  if (osName === 'mac') {
    const base = `node-v${NODE_VERSION}-darwin-${arch}`;
    return { file: `${base}.tar.gz`, binary: `${base}/bin/node`, license: `${base}/LICENSE`, exe: 'node' };
  }
  const base = `node-v${NODE_VERSION}-win-${arch}`;
  return { file: `${base}.zip`, binary: `${base}/node.exe`, license: `${base}/LICENSE`, exe: 'node.exe' };
}

let shasums;
async function expectedSha256(file) {
  if (!shasums) {
    const res = await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`);
    if (!res.ok) throw new Error(`SHASUMS256.txt 다운로드 실패: ${res.status}`);
    shasums = await res.text();
  }
  const line = shasums.split('\n').find((l) => l.trim().endsWith(`  ${file}`));
  if (!line) throw new Error(`SHASUMS256.txt에 ${file}이 없습니다.`);
  return line.split(/\s+/)[0];
}

async function sha256(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

async function fetchTarget(target) {
  const destDir = path.join(outRoot, target);
  const info = distInfo(target);
  const destBin = path.join(destDir, info.exe);
  const marker = path.join(destDir, '.node-version');
  if (existsSync(destBin) && existsSync(marker) && readFileSync(marker, 'utf-8').trim() === NODE_VERSION) {
    console.log(`[skip] ${target}: node ${NODE_VERSION} 이미 존재`);
    return;
  }

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'evermock-node-'));
  try {
    const url = `https://nodejs.org/dist/v${NODE_VERSION}/${info.file}`;
    const archive = path.join(tmp, info.file);
    console.log(`[fetch] ${target}: ${url}`);
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`다운로드 실패(${target}): ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(archive));

    const [actual, expected] = await Promise.all([sha256(archive), expectedSha256(info.file)]);
    if (actual !== expected) throw new Error(`SHA-256 불일치(${info.file}): ${actual} != ${expected}`);

    // 바이너리와 LICENSE만 추출(bsdtar는 tar.gz와 zip 모두 처리).
    execFileSync('tar', ['-xf', archive, '-C', tmp, info.binary, info.license], { stdio: 'inherit' });

    await rm(destDir, { recursive: true, force: true });
    await mkdir(destDir, { recursive: true });
    await rename(path.join(tmp, info.binary), destBin);
    await rename(path.join(tmp, info.license), path.join(destDir, 'LICENSE'));
    if (info.exe === 'node') await chmod(destBin, 0o755);
    await writeFile(marker, `${NODE_VERSION}\n`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  // 빌드 호스트와 같은 대상만 실행 검증(다른 OS/아키텍처 바이너리는 실행 불가).
  const hostTarget = `${process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : process.platform}-${process.arch}`;
  if (target === hostTarget) {
    const out = execFileSync(destBin, ['-p', 'process.version + " openssl " + process.versions.openssl'], {
      encoding: 'utf-8'
    }).trim();
    console.log(`[ok] ${target}: ${out}`);
  } else {
    console.log(`[ok] ${target}: node ${NODE_VERSION} (SHA-256 검증, 교차 대상이라 실행 검증 생략)`);
  }
}

async function main() {
  const targets = parseTargets();
  console.log(`Node ${NODE_VERSION} 준비: ${targets.join(', ')}`);
  for (const legacy of ['arm64', 'x64']) {
    // 이전 레이아웃(resources/node/<arch>)은 플랫폼 구분이 없어 Windows 빌드에 macOS 바이너리가 섞일 수 있다.
    if (existsSync(path.join(outRoot, legacy))) {
      await rm(path.join(outRoot, legacy), { recursive: true, force: true });
      console.log(`[clean] 이전 레이아웃 삭제: resources/node/${legacy}`);
    }
  }
  for (const target of targets) await fetchTarget(target);
  console.log('완료:', outRoot);
}

main().catch((e) => {
  console.error('실패:', e.message ?? e);
  process.exit(1);
});
