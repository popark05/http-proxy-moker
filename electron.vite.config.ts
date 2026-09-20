import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // 프록시 엔진은 순정 Node 자식 프로세스로 fork된다(Electron BoringSSL 회피).
          // out/main/proxy-worker.js 로 빌드되어 ProxyService가 fork한다.
          'proxy-worker': resolve('src/main/proxy/proxy-worker-entry.ts')
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
