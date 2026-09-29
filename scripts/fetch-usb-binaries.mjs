/**
 * `usb`(node-usb 3.x) 네이티브 바이너리 패키지를 macOS 두 아키텍처 모두 node_modules에 배치한다.
 *
 * 배경: node-usb는 플랫폼별 바이너리를 optionalDependencies(@node-usb/usb-darwin-<arch>)로 배포하므로
 * npm은 현재 머신 아키텍처 것만 설치한다. electron-builder는 node_modules를 그대로 패키징하므로,
 * arm64/x64 DMG를 한 머신에서 만들려면 두 바이너리가 모두 있어야 한다(없으면 해당 DMG에서 USB 연결 불가).
 * N-API 모듈이라 Electron용 재빌드는 필요 없다.
 *
 * 사용: node scripts/fetch-usb-binaries.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ARCHES = ['arm64', 'x64'];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usbPackage = JSON.parse(readFileSync(path.join(root, 'node_modules', 'usb', 'package.json'), 'utf-8'));
const version = usbPackage.version;

for (const arch of ARCHES) {
  const name = `@node-usb/usb-darwin-${arch}`;
  const dest = path.join(root, 'node_modules', '@node-usb', `usb-darwin-${arch}`);
  const installed = path.join(dest, 'package.json');
  if (existsSync(installed) && JSON.parse(readFileSync(installed, 'utf-8')).version === version) {
    console.log(`[skip] ${name}@${version} 이미 존재`);
    continue;
  }

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'usb-bin-'));
  try {
    const tarball = execFileSync('npm', ['pack', `${name}@${version}`, '--pack-destination', tmp, '--silent'], {
      encoding: 'utf-8'
    })
      .trim()
      .split('\n')
      .pop();
    await rm(dest, { recursive: true, force: true });
    await mkdir(dest, { recursive: true });
    execFileSync('tar', ['-xzf', path.join(tmp, tarball), '-C', dest, '--strip-components=1']);
    console.log(`[ok] ${name}@${version} → ${path.relative(root, dest)}`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
