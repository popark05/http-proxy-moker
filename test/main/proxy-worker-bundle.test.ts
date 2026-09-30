// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest';
import { fork } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildProxyWorker, WORKER_FILE } from '../../scripts/build-proxy-worker.mjs';

// 설치된 앱에서는 워커 옆에 node_modules가 없다(asar 안에만 있음). repo 밖 임시 폴더에 번들해
// fork하고 ready 신호가 오는지로 "모든 의존성이 번들에 포함됐는지"를 검증한다.
// 전체 동작(프록시·압축 디코딩)은 `npm run verify:worker`로 검증한다.

let workDir: string | undefined;
afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

describe('proxy worker bundle', () => {
  it('node_modules 없는 위치에서 워커가 모듈을 모두 해석하고 ready를 보냄', async () => {
    workDir = await mkdtemp(path.join(os.tmpdir(), 'evermock-worker-test-'));
    const outDir = path.join(workDir, 'app.asar.unpacked', 'out', 'main');
    const assets: string[] = await buildProxyWorker(outDir);
    const workerFile = path.join(outDir, WORKER_FILE);

    expect(assets).toContain('brotli_wasm_bg.wasm');
    expect(existsSync(path.join(outDir, 'brotli_wasm_bg.wasm'))).toBe(true);
    // mockttp 등 런타임 의존성을 외부 require로 남기지 않는다(선택적 가속 모듈만 예외).
    const source = readFileSync(workerFile, 'utf-8');
    expect(source).not.toMatch(/require\(["']mockttp["']\)/);

    const worker = fork(workerFile, [], {
      cwd: workDir,
      env: { ...process.env, NODE_PATH: '' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc']
    });
    let stderr = '';
    worker.stderr?.on('data', (d) => (stderr += d));
    try {
      const outcome = await new Promise<string>((resolve) => {
        worker.on('message', (msg: { kind?: string }) => msg.kind === 'ready' && resolve('ready'));
        worker.on('exit', (code) => resolve(`exit ${code}: ${stderr}`));
        setTimeout(() => resolve(`timeout: ${stderr}`), 15_000);
      });
      expect(outcome).toBe('ready');
    } finally {
      worker.kill();
    }
  }, 60_000);
});
