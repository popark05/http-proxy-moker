/**
 * adbd root/unroot 재시작. dadb Dadb.root/unroot 이식(Apache-2.0, NOTICE 참고).
 *
 * `root:`/`unroot:` 서비스는 응답 한 줄을 보낸 뒤 adbd를 재시작하므로 연결이 끊긴다.
 * dadb는 첫 오류가 나면 바로 성공으로 끝내지만, 여기서는 adbd가 돌아와 상태가 바뀐 것을 확인할 때까지
 * (Dadb의 재연결로) 폴링한다. 재연결까지 시간이 걸리는 TCP 에뮬레이터에서 다음 작업이 실패하지 않게 하기 위함.
 */

import { StreamReader } from '../protocol/stream-io';
import { SUCCESS, failure, type RootResult } from '../results';
import type { AdbOpener } from './opener';
import { shell } from './shell';

export interface RestartOptions {
  /** adbd 재시작을 기다리는 최대 시간(ms). 기본 15초. */
  timeoutMs?: number;
  /** 폴링 간격(ms). 기본 300ms. */
  intervalMs?: number;
}

export function root(adb: AdbOpener, options?: RestartOptions): Promise<RootResult> {
  return restartAdbd(adb, 'root:', true, (r) => r.startsWith('restarting') || r.includes('already'), options);
}

export function unroot(adb: AdbOpener, options?: RestartOptions): Promise<RootResult> {
  return restartAdbd(
    adb,
    'unroot:',
    false,
    (r) => r.startsWith('restarting') || r.includes('not running as root'),
    options
  );
}

async function restartAdbd(
  adb: AdbOpener,
  service: string,
  asRoot: boolean,
  isSuccess: (response: string) => boolean,
  options: RestartOptions = {}
): Promise<RootResult> {
  const stream = await adb.open(service);
  let response: string;
  try {
    response = (await new StreamReader(stream).readUntil(0x0a)).toString('utf-8');
  } finally {
    await stream.close();
  }
  if (!isSuccess(response)) return failure(response.trim());

  const expected = asRoot ? '1' : '0';
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  for (;;) {
    try {
      const prop = await shell(adb, 'getprop service.adb.root');
      // 속성이 비어 있으면 root가 아닌 것(0)으로 본다.
      if ((prop.output.trim() || '0') === expected) return SUCCESS;
    } catch {
      // adbd 재시작 중: 연결 끊김/거부는 예상된 상황이므로 계속 기다린다.
    }
    if (Date.now() >= deadline) return failure(`adbd 재시작 대기 시간 초과: ${response.trim()}`);
    await new Promise((r) => setTimeout(r, options.intervalMs ?? 300));
  }
}
