/**
 * `usb`(node-usb 3.x) 네이티브 바이너리 패키지를 대상 플랫폼별로 node_modules에 배치한다.
 *
 * 배경: node-usb는 플랫폼별 바이너리를 optionalDependencies(@node-usb/usb-<platform>)로 배포하므로
 * npm은 빌드 머신의 것만 설치한다. electron-builder는 node_modules를 그대로 패키징하므로, 한 머신에서
 * 여러 아키텍처(또는 다른 OS) 설치본을 만들려면 대상 바이너리가 모두 있어야 한다(없으면 그 설치본에서
 * USB 직접 연결 불가 → adb server 경유로만 동작). N-API 모듈이라 Electron용 재빌드는 필요 없다.
 * macOS·Windows 빌드 머신 모두에서 실행 가능.
 *
 * 사용:
 *   node scripts/fetch-usb-binaries.mjs                 # 현재 OS용 대상(mac: arm64+x64 / win: x64+arm64)
 *   node scripts/fetch-usb-binaries.mjs --targets all   # 모든 대상(교차 빌드용)
 *   node scripts/fetch-usb-binaries.mjs --targets win-x64,mac-arm64
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 대상 → node-usb 플랫폼 패키지 접미사. */
const PACKAGES = {
  'mac-arm64': 'usb-darwin-arm64',
  'mac-x64': 'usb-darwin-x64',
  'win-x64': 'usb-win32-x64-msvc',
  'win-arm64': 'usb-win32-arm64-msvc'
};
const HOST_TARGETS = {
  darwin: ['mac-arm64', 'mac-x64'],
  win32: ['win-x64', 'win-arm64']
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(path.join(root, 'node_modules', 'usb', 'package.json'), 'utf-8')).version;

function parseTargets() {
  const idx = process.argv.indexOf('--targets');
  const value = idx >= 0 ? process.argv[idx + 1] : undefined;
  if (!value) {
    const targets = HOST_TARGETS[process.platform];
    if (!targets) throw new Error(`지원하지 않는 빌드 호스트: ${process.platform} (--targets로 지정)`);
    return targets;
  }
  const targets = value === 'all' ? Object.keys(PACKAGES) : value.split(',').map((t) => t.trim());
  for (const t of targets) if (!PACKAGES[t]) throw new Error(`알 수 없는 대상: ${t}`);
  return targets;
}

/**
 * npm 실행. npm 스크립트로 실행되면 npm_execpath(npm-cli.js)를 현재 Node로 직접 실행한다
 * (Windows의 npm.cmd는 shell 없이 실행할 수 없고, Node 18.20.2/20.12.2+는 .cmd를 shell 없이 거부).
 */
function npm(args, cwd) {
  const npmCli = process.env.npm_execpath;
  if (npmCli && /\.(c|m)?js$/.test(npmCli)) {
    return execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf-8' });
  }
  return execFileSync('npm', args, { cwd, encoding: 'utf-8', shell: process.platform === 'win32' });
}

for (const target of parseTargets()) {
  const pkg = PACKAGES[target];
  const name = `@node-usb/${pkg}`;
  const dest = path.join(root, 'node_modules', '@node-usb', pkg);
  const installed = path.join(dest, 'package.json');
  if (existsSync(installed) && JSON.parse(readFileSync(installed, 'utf-8')).version === version) {
    console.log(`[skip] ${name}@${version} 이미 존재`);
    continue;
  }

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'usb-bin-'));
  try {
    npm(['pack', `${name}@${version}`, '--pack-destination', tmp, '--silent'], tmp);
    const tarball = (await readdir(tmp)).find((f) => f.endsWith('.tgz'));
    if (!tarball) throw new Error(`${name}@${version} 패키지를 받지 못했습니다.`);
    await rm(dest, { recursive: true, force: true });
    await mkdir(dest, { recursive: true });
    // bsdtar/GNU tar 모두 지원(Windows 10+는 tar.exe 기본 포함).
    execFileSync('tar', ['-xzf', path.join(tmp, tarball), '-C', dest, '--strip-components=1']);
    console.log(`[ok] ${name}@${version} → ${path.relative(root, dest)}`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
