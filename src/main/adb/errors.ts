/**
 * ADB 전송/연결 계층 오류 계층. dadb AdbException.kt 이식(Apache-2.0, NOTICE 참고).
 *
 * 전송 실패는 이 타입들로 throw하고, 작업 결과(설치 실패, 셸 종료 코드 등)는 값으로 반환한다.
 * 공개 메서드에서 나가는 전송 오류는 모두 AdbException 하위 타입이어야 한다.
 */

export abstract class AdbException extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
  }
}

/** 연결 수립 실패(TCP/USB 연결, CNXN 핸드셰이크). 아무것도 실행되지 않았으므로 재연결로 재시도 가능. */
export class AdbConnectException extends AdbException {}

/**
 * USB 기기의 ADB 인터페이스를 열거나 점유하지 못함. 흔한 원인: adb server(Android Studio 포함)가
 * 이미 점유, Windows에서 ADB 인터페이스에 WinUSB가 아닌 드라이버가 붙음. Dadb는 이 오류일 때
 * 실행 중인 adb server를 경유하는 방식으로 대체할 수 있다.
 */
export class AdbUsbAccessException extends AdbConnectException {}

/** 인증 거부(키 없음, 기기에서 허용 안 함). 같은 키로 재연결해도 소용없음 — 기기에서 허용해야 한다. */
export class AdbAuthException extends AdbException {}

/** adbd가 스트림 OPEN을 거부(OPEN에 CLSE로 응답). 연결 자체는 계속 사용 가능. */
export class AdbStreamOpenException extends AdbException {
  constructor(
    readonly destination: string,
    message: string,
    cause?: unknown
  ) {
    super(message, cause);
  }
}

/** 수립된 연결/스트림이 예기치 않게 끊김. 작업이 일부 실행됐을 수 있으니 재시도 전 상태 확인 필요. */
export class AdbConnectionClosedException extends AdbException {}

/** adbd 무응답으로 기한 초과(읽기/쓰기). 재연결 필요. */
export class AdbTimeoutException extends AdbException {}

/** 상대가 잘못된/예상 밖 패킷을 보냄(동기 깨짐). 재동기화 불가 — 연결을 닫고 다시 수립해야 한다. */
export class AdbProtocolException extends AdbException {}
