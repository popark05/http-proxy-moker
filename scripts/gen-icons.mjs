/**
 * build/icon.svg → 앱 아이콘 에셋 생성.
 * - build/icon.png (512, electron-builder linux/일반용)
 * - build/icon.iconset/*.png → build/icon.icns (macOS, iconutil)
 * - src/renderer/src/assets/logo.svg 복사(UI 워드마크용)
 *
 * 사용: node scripts/gen-icons.mjs
 * 요구: sharp(설치돼 있어야 함), macOS iconutil
 */
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svgPath = path.join(root, 'build', 'icon.svg');
const buildDir = path.join(root, 'build');
const iconsetDir = path.join(buildDir, 'icon.iconset');

async function png(size, outPath) {
  await sharp(svgPath, { density: 384 })
    .resize(size, size, { fit: 'contain' })
    .png()
    .toFile(outPath);
}

async function main() {
  await fs.mkdir(iconsetDir, { recursive: true });

  // 일반 512 PNG
  await png(512, path.join(buildDir, 'icon.png'));
  await png(1024, path.join(buildDir, 'icon@1024.png'));

  // macOS iconset (표준 크기 세트)
  const specs = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png']
  ];
  for (const [size, name] of specs) {
    await png(size, path.join(iconsetDir, name));
  }

  // iconset → icns
  execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', path.join(buildDir, 'icon.icns')]);
  console.log('생성 완료: build/icon.png, build/icon.icns');
}

main().catch((e) => {
  console.error('아이콘 생성 실패:', e);
  process.exit(1);
});
