/**
 * ADB 통신 진단 로그(기본 꺼짐). `EVERMOCK_ADB_TRACE=1`로 켜면 패킷 송수신, 열린 스트림 수, 프록시 요청/응답을
 * 같은 시간축(UTC `HH:MM:SS.mmm`)에 출력해 "어느 쪽이 먼저 닫았는가"를 대조할 수 있다.
 * 프록시 워커 프로세스에서도 같은 환경변수를 쓴다(자식 프로세스가 환경을 상속).
 */
export const ADB_TRACE = process.env.EVERMOCK_ADB_TRACE === '1';

const COMMAND_NAMES: Record<number, string> = {
  0x4e584e43: 'CNXN',
  0x48545541: 'AUTH',
  0x4e45504f: 'OPEN',
  0x59414b4f: 'OKAY',
  0x45534c43: 'CLSE',
  0x45545257: 'WRTE'
};

export function adbCommandName(command: number): string {
  return COMMAND_NAMES[command] ?? `0x${command.toString(16)}`;
}

/** 한 줄 출력. 호출부에서 `if (ADB_TRACE)`로 감싸 문자열 조립 비용도 피한다. */
export function adbTrace(line: string): void {
  console.log(`[adb ${new Date().toISOString().slice(11, 23)}] ${line}`);
}
