import type { AdbStream } from '../protocol/stream';
import { AdbUnsupportedFeatureException } from '../results';

/**
 * 서비스 계층이 기기에 요구하는 최소 표면(dadb Dadb 인터페이스의 open/supportsFeature).
 * Dadb가 구현하며, 테스트는 가짜 연결로 대체할 수 있다.
 */
export interface AdbOpener {
  open(destination: string): Promise<AdbStream>;
  supportsFeature(feature: string): Promise<boolean>;
}

/** `exec:cmd <args>` 스트림(Android 7+ `cmd` 기능 필요). stdout만 오고 종료 코드는 없다. */
export async function execCmd(adb: AdbOpener, ...command: string[]): Promise<AdbStream> {
  if (!(await adb.supportsFeature('cmd'))) {
    throw new AdbUnsupportedFeatureException('cmd', '이 Android 버전은 cmd를 지원하지 않습니다.');
  }
  return adb.open(['exec:cmd', ...command].join(' '));
}

/** `abb_exec:` 스트림(Android Binder Bridge, 인자를 NUL로 구분). */
export async function abbExec(adb: AdbOpener, ...command: string[]): Promise<AdbStream> {
  if (!(await adb.supportsFeature('abb_exec'))) {
    throw new AdbUnsupportedFeatureException('abb_exec', '이 Android 버전은 abb_exec를 지원하지 않습니다.');
  }
  return adb.open(`abb_exec:${command.join('\0')}`);
}
