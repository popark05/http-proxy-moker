# 계약 테스트(Contract Test) 기능 계획

작성: 2026-10-25. 새 세션에서 이 문서만 읽고 바로 시작할 수 있게 정리했다. 아직 코드는 한 줄도 쓰지 않았다.

## 1. 목표

캡처해서 저장한 요청/응답을 **"계약"**으로 삼아, QA가 프론트엔드와 백엔드를 서로 독립적으로 검증한다.

| 검증 대상 | 방법 | 이미 있는 것 |
|---|---|---|
| 백엔드 | 계약의 요청을 실제 서버로 보내고, 응답이 계약과 같은 모양인지 비교 → 엔드포인트별 통과/실패 | 없음(새로 만든다) |
| 프론트엔드 | 실제 서버 없이 계약 응답으로 앱을 돌리고, 앱이 계약과 다른 요청을 보내면 위반으로 표시 | 목 모드(응답 제공) |

## 2. 현재 코드에서 확인한 사실 (설계 전제)

- `MockDefinition`/`MockCase`/`LibraryEndpoint`(`src/shared/mock.ts`, `scenario-library.ts`)에는 **method + host + path + 응답**이 있다(host는 필수, 2026-10-31 추가. 호스트 도입 전 파일은 빈 문자열=모든 호스트). 쿼리, 요청 헤더, 요청 본문은 없다.
- 캡처(`CapturedExchange`, HAR 저장)에는 전체 요청이 있다. 계약은 **캡처에서 만들어야** 한다.
- 프록시 워커는 순정 Node 자식 프로세스다(Electron main의 TLS가 BoringSSL이라 mockttp 업스트림 HTTPS가 깨지는 문제). **백엔드로 요청을 보내는 실행기도 같은 이유로 워커 쪽(순정 Node)에서 돌려야 한다.** 워커 프로토콜은 `src/shared/proxy-worker.ts`(`WorkerCommand`/`WorkerMessage`).
- 사내망은 SSL 인터셉션이 있다. 순정 Node 요청은 `NODE_EXTRA_CA_CERTS`를 따른다(CLAUDE.md "사내망" 절). 실행기에서 인증서 오류를 사용자에게 알기 쉽게 보여줘야 한다.
- `ajv`가 `node_modules`에 있지만 간접 의존성이다. 쓰려면 `package.json`에 직접 추가하고, **워커 번들(esbuild → `proxy-worker.cjs`)에 들어가는지, `new Function` 코드 생성이 번들/설치본에서 동작하는지** 확인해야 한다(`scripts/build-proxy-worker.mjs`는 `__dirname` 파일 읽기를 금지한다).
- 프로젝트 파일 구조: `project.json`, `library.json`, `captures/*.har.json`, `scenarios/*.json`(`src/main/project/project-store.ts`, 파일명 sanitize 있음).

## 3. 데이터 모델 (초안)

프로젝트 폴더에 `contracts/<이름>.json`을 추가한다(Git 공유 대상).

```ts
interface Contract {
  version: 1;
  id: string;
  /** 엔드포인트 식별: `METHOD /path` (케이스 라이브러리의 endpoint id와 같은 규칙) */
  endpointId: string;
  name: string;
  /** 캡처 출처(참고용). */
  source?: { captureName?: string; exchangeId?: string; capturedAt: number };
  request: {
    method: string;
    /** 서버 주소는 변수: "{{baseUrl}}/v1/users". 호스트 부분만 변수로 치환한다. */
    urlTemplate: string;
    query: Array<[string, string]>;
    /** 값에 {{var}}를 쓸 수 있다. 인증 헤더는 값을 저장하지 않고 변수 이름만 둔다. */
    headers: Array<[string, string]>;
    body?: { encoding: 'text' | 'base64'; content: string; contentType?: string };
  };
  expect: {
    status: number | { min: number; max: number };
    /** 이 헤더들이 있어야 한다(값은 type/regex/무시 중 선택). */
    headers: Array<{ name: string; match: 'present' | 'equals' | 'regex'; value?: string }>;
    /** JSON 본문 모양. 캡처 응답에서 자동 추론해 사용자가 필드별로 조정한다. */
    bodySchema?: JsonSchemaLite;
  };
  /** 실제 서버에서 재현 불가한 케이스(500, 타임아웃 등)는 false. */
  verifiable: boolean;
  /** 실제 서버로 보내도 안전한가(GET 등). 기본: GET/HEAD/OPTIONS만 true. */
  safeToRun: boolean;
  tags?: string[];
}
```

- 본문 비교의 **기본은 모양(타입, 필수 여부)**이다. 시간/ID/토큰처럼 매번 달라지는 값 때문에 값 비교는 거의 항상 실패한다. 필드마다 `type만 | 값까지 | 무시`를 고른다.
- 스키마 추론: 캡처 응답 JSON에서 타입/필수 키/배열 원소 모양/null 허용을 만든다. 같은 엔드포인트의 여러 캡처(여러 호출)를 합치면 선택 필드를 더 정확히 알 수 있다. 직접 짧게 구현하거나 가벼운 MIT 라이브러리를 쓴다(결정 필요).
- 검증은 `ajv`(JSON Schema)로 한다. 결과에는 위반 경로(`$.items[2].id: 숫자여야 함`)를 담는다.

## 4. 단계별 계획

### 1단계 — 백엔드 검증 MVP (가장 먼저)
1. **계약 만들기**: 트래픽 목록에서 요청 선택 → "계약으로 저장". 캡처의 요청 정보와 추론한 응답 모양을 채운다. 서버 주소는 `{{baseUrl}}`로 치환하고 인증 헤더는 변수화.
2. **실행 설정**: 대상 서버 목록(이름 + baseUrl, 프로젝트에 저장), 실행 변수(토큰 등, **파일에 저장하지 않고 실행 시 입력**). 운영 서버 오조작 방지를 위해 등록된 서버 중에서만 선택.
3. **실행기**: 워커(순정 Node)에서 요청 전송 → 응답 검증 → 결과 이벤트 스트림. 기본은 **GET/HEAD/OPTIONS만 실행**, 그 외 메서드는 명시적으로 허용해야 한다. 요청당 타임아웃, 동시 실행 수 제한.
4. **결과 화면**: 엔드포인트별 통과/실패/건너뜀(이유 표시), 실패 상세(기대 vs 실제, 위반 경로), 응답 시간. 결과는 `reports/`에 JSON으로 저장.
5. **테스트**: 스키마 추론, 검증, 변수 치환, 안전장치(GET 외 차단)는 순수 함수로 만들어 단위 테스트. 실행기는 `ProxyEngine`처럼 목 HTTP 서버를 띄워 통합 테스트.

### 2단계 — 프론트엔드 검증
1. 목 모드에서 앱이 보낸 요청을 계약의 요청 견본과 비교(필수 쿼리/헤더/본문 모양)해 **위반 목록** 표시. 프록시 워커의 요청 이벤트에서 판정(`ruleToMock` 경로와 같은 곳에 훅).
2. **커버리지**: 계약에는 있는데 앱이 한 번도 부르지 않은 엔드포인트, 계약에 없는 요청(미등록) 표시. 기존 `unmatchedPolicy`(block/passthrough)와 함께 보여준다.

### 3단계 — 자동화와 공유
1. 화면 없는 CLI(`node scripts/run-contracts.mjs <프로젝트> --server <이름> --junit out.xml`), CI에서 실행.
2. 계약 변경 비교(캡처를 다시 떠서 "계약 업데이트 제안" → diff 확인 후 승인).
3. 가져오기/내보내기: OpenAPI, Bruno 컬렉션(`reference/bruno`, MIT. 코드보다 아이디어를 가져온다. 이름/로고는 상표라 사용 금지).

## 5. 먼저 정해야 할 것 (기본값을 두고 시작해도 됨)

| 질문 | 제안(기본값) |
|---|---|
| 로그인 토큰 | 계약에 저장하지 않고 실행 시 변수로 입력. 만료된 캡처 토큰은 쓰지 않는다. |
| 위험한 요청(POST/PUT/DELETE) | 기본 건너뜀. 계약별로 "실행 허용" 체크 + 실행 전 확인. |
| 대상 서버 | 프로젝트에 등록한 서버만 선택(개발/스테이징). 운영 서버 이름 패턴이면 경고. |
| 스키마 추론 방식 | 직접 구현(작고 의존성 없음). 부족하면 라이브러리로 교체. |
| 케이스 라이브러리와의 관계 | 계약은 케이스와 연결(`endpointId`)하되 별도 파일. 케이스 = 응답 예시, 계약 = 요청+기대. |

## 6. 위험과 확인할 것

- 워커 번들에 `ajv`를 넣었을 때 설치본(macOS/Windows)에서 동작하는지: `npm run verify:worker`와 패키징 검증 필요.
- 사내망 인증서 오류 메시지(`self-signed certificate in certificate chain`)를 사용자 친화적으로 안내.
- 큰 응답 본문(캡처는 500KB 제한이 있고 초과 시 `omitted`)은 스키마를 추론할 수 없다 → "추론 불가" 상태 표시.
- 응답이 JSON이 아닌 경우(HTML/이진): 상태 코드와 헤더만 검증.
- 개인정보/토큰이 캡처 본문에 들어 있다: 계약 파일을 Git에 올리기 전 마스킹(민감 헤더/필드 목록) 옵션이 필요하다.

## 7. 새 세션에서 시작하는 법

1. 이 문서와 메모리 `session-handoff-2026-10-24`를 읽는다.
2. 브랜치 `feat/contract-test`를 main에서 만든다. (참고: 루트의 `AGENTS.md`는 untracked 상태로 두고 건드리지 않는다.)
3. 위 "1단계"의 1~2번(계약 모델 + 스키마 추론 + 검증, 순수 함수와 테스트)부터 구현한다. UI는 그다음.
4. 작업 방식은 기존 약속을 따른다: 한국어로 답하고, 단계마다 typecheck/vitest/build 확인, 실기기/설치본에서 확인하지 못한 것은 명확히 알린다. 푸시/머지는 사용자 요청 시에만.
