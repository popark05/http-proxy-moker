/**
 * 프록시 워커 실행용 Node 바이너리를 다운로드해 resources/node/<arch>/node 로 배치한다.
 *
 * 배경: 프록시 엔진(mockttp)은 OpenSSL Node에서만 업스트림 HTTPS가 동작한다.
 * Electron 런타임(BoringSSL)에서는 INVALID_COMMAND로 깨진다. 그래서 앱에 OpenSSL Node를
 * 번들해 어떤 맥에서도 프록시가 동작하도록 한다(시스템 Node 설치 불필요).
 *
 * macOS universal 앱을 위해 arm64/x64 두 아키텍처를 모두 받는다.
 * 사용: node scripts/fetch-node.mjs [version]
 */
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rm, chmod, rename } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const NODE_VERSION = process.argv[2] ?? process.versions.node; // 기본: 현재 Node 버전
const ARCHES = ['arm64', 'x64'];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = path.join(root, 'resources', 'node');

async function fetchArch(arch) {
  const destDir = path.join(outRoot, arch);
  const destBin = path.join(destDir, 'node');
  if (existsSync(destBin)) {
    console.log(`[skip] ${arch} 이미 존재: ${destBin}`);
    return;
  }
  await mkdir(destDir, { recursive: true });

  const base = `node-v${NODE_VERSION}-darwin-${arch}`;
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${base}.tar.gz`;
  const tarPath = path.join(destDir, `${base}.tar.gz`);

  console.log(`[fetch] ${arch}: ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`다운로드 실패(${arch}): ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tarPath));

  // tar에서 node 바이너리만 추출.
  execFileSync('tar', ['-xzf', tarPath, '-C', destDir], { stdio: 'inherit' });
  const extractedBin = path.join(destDir, base, 'bin', 'node');
  await rename(extractedBin, destBin);
  await chmod(destBin, 0o755);

  // 정리(tar + 추출 디렉토리).
  await rm(tarPath, { force: true });
  await rm(path.join(destDir, base), { recursive: true, force: true });

  // 현재 호스트 아키텍처와 같을 때만 실행 검증(교차 아키텍처는 실행 불가).
  if (arch === process.arch) {
    const ver = execFileSync(destBin, ['-e', 'process.stdout.write(process.versions.openssl)'], {
      encoding: 'utf-8'
    });
    console.log(`[ok] ${arch}: node ${NODE_VERSION}, openssl ${ver}`);
  } else {
    console.log(`[ok] ${arch}: node ${NODE_VERSION} (교차 아키텍처, 실행 검증 생략)`);
  }
}

async function main() {
  console.log(`Node ${NODE_VERSION} 바이너리 준비 (arm64, x64)...`);
  for (const arch of ARCHES) {
    await fetchArch(arch);
  }
  console.log('완료:', outRoot);
}

main().catch((e) => {
  console.error('실패:', e);
  process.exit(1);
});
