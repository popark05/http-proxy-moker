import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';
import { buildProxyWorker, watchProxyWorker } from './scripts/build-proxy-worker.mjs';

/**
 * 프록시 워커를 의존성까지 포함한 단일 CJS 파일(out/main/proxy-worker.cjs)로 번들한다.
 * 워커는 asar를 못 읽는 순정 Node로 실행되므로 node_modules에 의존하면 설치된 앱에서 죽는다
 * (자세한 배경은 scripts/build-proxy-worker.mjs). main 빌드가 끝난 뒤 실행하고, dev에서는 watch한다.
 */
function proxyWorkerPlugin(): Plugin {
  let outDir = 'out/main';
  let watching = false;
  return {
    name: 'evermock-proxy-worker',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      if (this.meta.watchMode) {
        if (!watching) {
          watching = true;
          await watchProxyWorker(outDir);
        }
        return;
      }
      await buildProxyWorker(outDir);
    }
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), proxyWorkerPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts')
          // 프록시 워커(proxy-worker.cjs)는 proxyWorkerPlugin이 별도로 전부 번들한다.
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        // preload는 CommonJS여야 한다. package.json "type":"module" 하에서는
        // .js가 ESM으로 해석되므로 .cjs 확장자로 출력해 CommonJS로 로드되게 한다.
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        // shadcn 관례 alias(@/ → renderer/src)와 기존 alias 병행.
        '@': resolve('src/renderer/src'),
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') }
      }
    }
  }
});
