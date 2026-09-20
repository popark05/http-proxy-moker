import type { CaptureEvent, CapturedExchange } from '@shared/capture';

/**
 * 캡처 이벤트를 exchange 목록에 반영하는 순수 리듀서.
 * request는 새 exchange를 추가하고, response/abort는 id로 기존 exchange를 갱신한다.
 * React 밖에서도 테스트 가능하도록 순수 함수로 유지.
 */
export function reduceCapture(
  exchanges: CapturedExchange[],
  event: CaptureEvent
): CapturedExchange[] {
  switch (event.type) {
    case 'request':
      // 동일 id가 이미 있으면 무시(중복 방지).
      if (exchanges.some((e) => e.id === event.exchange.id)) return exchanges;
      return [...exchanges, event.exchange];

    case 'response':
      return exchanges.map((e) =>
        e.id === event.id ? { ...e, response: event.response } : e
      );

    case 'abort':
      return exchanges.map((e) => (e.id === event.id ? { ...e, response: 'aborted' } : e));

    default:
      return exchanges;
  }
}

/** exchange에 태그를 추가(중복 무시). 순수 함수. */
export function addTag(
  exchanges: CapturedExchange[],
  id: string,
  tag: string
): CapturedExchange[] {
  const clean = tag.trim();
  if (!clean) return exchanges;
  return exchanges.map((e) => {
    if (e.id !== id) return e;
    const tags = e.tags ?? [];
    if (tags.includes(clean)) return e;
    return { ...e, tags: [...tags, clean] };
  });
}

/** exchange에서 태그를 제거. 순수 함수. */
export function removeTag(
  exchanges: CapturedExchange[],
  id: string,
  tag: string
): CapturedExchange[] {
  return exchanges.map((e) => {
    if (e.id !== id) return e;
    const tags = (e.tags ?? []).filter((t) => t !== tag);
    return { ...e, tags };
  });
}
