/** scripts/build-proxy-worker.mjs 타입 선언(electron.vite.config.ts에서 import). */
export declare const WORKER_ENTRY: string;
export declare const WORKER_FILE: string;
/** 워커를 outDir에 번들하고 복사한 런타임 자산 파일명을 돌려준다. */
export declare function buildProxyWorker(outDir?: string): Promise<string[]>;
/** 개발 모드 watch. 반환값은 esbuild BuildContext. */
export declare function watchProxyWorker(outDir: string): Promise<{ dispose(): Promise<void> }>;
