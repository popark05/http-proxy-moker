import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

// Monaco 워커 (오프라인 데스크탑: CDN 대신 번들된 워커 사용).
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';

let configured = false;

/**
 * @monaco-editor/react가 기본적으로 CDN에서 monaco를 로드하는 것을 막고,
 * 로컬 번들 monaco와 워커를 사용하도록 1회 설정한다.
 *
 * 중요: 이 설정은 <Editor>가 처음 마운트되기 "전에" 적용돼야 한다.
 * <Editor>는 마운트 즉시 loader.init()을 트리거하는데, 그 전에 loader.config({monaco})가
 * 실행되지 않으면 기본 CDN에서 monaco를 로드하려다 오프라인 데스크탑에서 영원히 "Loading.."에
 * 멈춘다. 따라서 useEffect(렌더 이후)가 아니라 이 모듈 import 시점(아래)에 즉시 호출한다.
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

// 모듈 로드 시점에 즉시 설정(Editor 마운트보다 먼저 보장).
setupMonaco();
