/**
 * ADB 바이트 전송 계층(L0) 추상화. TCP(net.Socket)와 USB(bulk 엔드포인트)가 구현한다.
 *
 * 프로토콜 계층은 이 인터페이스에만 의존한다. write는 호출 단위를 보존해야 한다:
 * USB는 헤더와 본문을 별도 bulk 전송으로 보내야 하므로, 패킷 writer가 두 번 나눠 호출한다.
 */
export interface AdbTransport {
  /** 바이트를 전송한다. 실패 시 throw(원인 오류 그대로; 상위에서 AdbException으로 변환). */
  write(data: Uint8Array): Promise<void>;
  /** 수신 청크 리스너 등록. 청크 경계는 메시지 경계와 무관하다. */
  onData(listener: (chunk: Uint8Array) => void): void;
  /** 연결 종료 리스너 등록. 오류로 끊겼으면 error가 전달된다. */
  onClose(listener: (error?: Error) => void): void;
  /** 연결을 닫는다(멱등). */
  close(): Promise<void>;
}
