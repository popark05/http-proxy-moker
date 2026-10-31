const pad = (n: number): string => String(n).padStart(2, '0');

/** 저장된 캡처 기본 이름: `session-20261031-134205`(저장 시각 기준이라 겹치지 않는다). */
export function newSessionName(now: Date = new Date()): string {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `session-${date}-${time}`;
}
