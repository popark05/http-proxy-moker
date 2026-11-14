export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

/** HTTP 상태 코드를 톤으로 매핑. */
export function statusTone(statusCode: number): BadgeTone {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warning';
  if (statusCode >= 300) return 'info';
  if (statusCode >= 200) return 'success';
  return 'neutral';
}

/** HTTP 메서드를 톤으로 매핑. */
export function methodTone(method: string): BadgeTone {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'info';
    case 'POST':
      return 'success';
    case 'PUT':
    case 'PATCH':
      return 'warning';
    case 'DELETE':
      return 'error';
    default:
      return 'neutral';
  }
}
