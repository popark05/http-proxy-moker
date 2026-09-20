import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

// Monaco 워커 (오프라인 데스크탑: CDN 대신 번들된 워커 사용).
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';

let configured = false;

/**
 * @monaco-editor/react가 기본적으로 CDN에서 monaco를 로드하는 것을 막고,
 * 로컬 번들 monaco와 워커를 사용하도록 1회 설정한다.
 */
export function setupMonaco(): void {
  if (configured) return;
  configured = true;

  // renderer 전역에 워커 팩토리 등록.
  (self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
    getWorker(_moduleId, label) {
      if (label === 'json') return new jsonWorker();
      return new editorWorker();
    }
  };

  loader.config({ monaco });
}
