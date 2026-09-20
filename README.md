# MokerProxy

모바일 앱(Android + iOS)의 API 호출을 캡처하고, 캡처한 응답을 복제·편집해 목 데이터로 저장한 뒤, 목킹 모드에서 백엔드 호출 없이 로컬 목 응답만 반환하는 QA용 맥 데스크탑 앱.

내부 QA 전용. 배포하지 않음.

## 스택

- Electron + Vite (`electron-vite`)
- React + TypeScript
- styled-components 기반 자체 디자인 시스템 (다크모드 기본)
- [mockttp](https://github.com/httptoolkit/mockttp) 프록시 엔진
- vitest 테스트

`reference/`의 HTTP Toolkit 오픈소스(AGPL)는 **참고 전용**이며, 코드를 직접 복사하지 않고 패턴/API만 참고한다.

## 개발

```bash
npm install
npm run dev        # electron-vite 개발 모드 (HMR)
npm run build      # 타입체크 + 프로덕션 번들
npm run test       # vitest
npm run typecheck  # main(node) + renderer(web) 타입체크
```

## 구조

```
src/
  main/        Electron main process (Node): 프록시, 기기 연동, CA, 파일 I/O, IPC
  preload/     contextBridge IPC 브리지 (contextIsolation)
  renderer/    React UI (디자인 시스템, 트래픽 뷰어, 목 편집기)
  shared/      main <-> renderer 공유 IPC 계약/타입
test/          vitest (main/renderer)
```

## 진행 상황 (Phase 1)

- [x] Task 1: Electron+React+TS 스캐폴딩 + 디자인 시스템 기반
- [x] Task 2: mockttp 프록시 시작/중지 + 캡처 이벤트 스트리밍
- [x] Task 3: CA 인증서 생성 및 HTTPS 캡처 (PEM + iOS .mobileconfig)
- [x] Task 4: 기기 연동 계층 추상화 + Android 자동 인터셉션
- [x] Task 5: iOS 기기 연동 (usbmux 감지 + 수동 셋업 가이드)
- [x] Task 6: 프로젝트 파일 저장/로드 + 캡처 세션 HAR
- [x] Task 7: 캡처 응답 복제/편집 → 목 정의 생성
- [x] Task 8: 목킹 모드 재생 (완전 목킹) 및 전체 통합

## Phase 1 완료

전체 워크플로우: 기기 연동(Android 자동 / iOS 반자동) → 프록시 캡처(HTTP/HTTPS) →
트래픽 뷰어 → 캡처 응답 복제·편집 → 목 시나리오 저장 → 목킹 모드 재생(백엔드 없이 목 응답).

## 진행 상황 (Phase 2)

- [x] Task 9: 목 정의에 지연·에러(fault) 주입 + 프록시 적용
- [x] Task 10: 목 편집기에 지연·fault UI
- [x] Task 11: 시나리오 관리 패널 (리스트 + 활성 표시 + 전환)

## Phase 2 완료

- 목 응답에 지연(ms) / 에러 주입(타임아웃·연결 리셋·연결 종료) 설정 가능
- 여러 목 시나리오를 저장하고 리스트에서 활성 시나리오를 전환 → 목킹 모드에서 즉시 반영
- 지연/fault 설정은 시나리오 JSON에 포함되어 저장/재적용

## 진행 상황 (Phase 3)

- [x] Task 12: 태그 데이터 모델 + HAR 보존 + 필터 순수 로직
- [x] Task 13: 필터 바 UI + 리스트 연동
- [x] Task 14: 태깅 UI + HAR 저장 연동

## Phase 3 완료

- 자유 텍스트 검색(URL/헤더/본문) + 구조적 필터(메서드/상태 클래스/호스트/태그)
- exchange에 태그 달기(상세에서 추가/제거), 리스트 행·필터에 태그 반영
- 태그는 캡처 세션 HAR(`_tags`)에 저장되어 재로드 시 보존

## 진행 상황 (Phase 3 확장 - Android non-root VPN)

- [x] Task 15: companion APK 관리자 + VPN 활성화 데이터 빌더
- [x] Task 16: AdbDevice 확장 + AndroidConnector VPN 모드
- [x] Task 17: 인터셉션 방식 선택 UI + 통합

## Android non-root VPN 완료

- HTTPToolkit companion VPN 앱(`tech.httptoolkit.android.v1`)을 재사용(자체 Android 앱 개발 없음)
- Android 인터셉션 방식 선택: 자동 / 시스템 CA(root) / VPN(non-root)
- VPN 모드: GitHub 릴리스에서 companion APK 다운로드·설치 → ACTIVATE 인텐트로 프록시/CA 지문 전달
- 프록시가 companion 검증 엔드포인트(`amiusing.httptoolkit.tech/certificate`, `android.httptoolkit.tech/config`)에 우리 CA를 응답 → 자체 CA로 HTTPS 복호화 신뢰

### 남은 로드맵 (미착수)
- iOS Frida 자동 인터셉션, QA 프로파일/팀 Git 공유

### 실기기 검증 완료 (Galaxy, Android 13, non-root)
- companion 앱이 우리 프록시에 연결 → 자체 CA 지문 신뢰(USER TRUST ENABLED) → CA 설치 → VPN 활성(tun0) → HTTP/HTTPS 트래픽 실시간 캡처(URL/경로 복호화) 확인
- non-root 환경이라 SYSTEM TRUST는 비활성(예상 동작): 유저 CA를 신뢰하는 앱/브라우저만 HTTPS 복호화
- 검증 스크립트: `node scripts/verify-vpn.mjs <deviceId>` (CA 생성 + 프록시 + ACTIVATE 인텐트, 기기에서 CA 설치·VPN 허용 후 캡처 로그 확인)

### 수동 검증이 필요한 항목
- GUI 육안 확인(트래픽 실시간 표시, 목 편집기, 모드 전환 시각 구분)
- 실제 Android 에뮬레이터/root 기기 인터셉션 및 시스템 CA 주입
- 실제 iOS 기기 WiFi 프록시 + CA 프로파일 설치
- CA 내보내기 저장 다이얼로그, 프로젝트 폴더 선택 다이얼로그
