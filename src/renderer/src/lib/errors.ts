/** 에러 객체에서 사용자 표시용 메시지 추출. */
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
