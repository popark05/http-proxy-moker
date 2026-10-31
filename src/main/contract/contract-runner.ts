/**
 * 컬렉션 요청 실행기: 요청을 실제 서버로 보내고 응답을 그대로 돌려준다.
 * 프록시 워커(순정 Node, OpenSSL)에서 실행한다 — Electron main의 TLS(BoringSSL)는 mockttp와 같은 이유로 쓰지 않는다.
 */
import {
  planRequest,
  type Contract,
  type ContractRunOptions,
  type PlannedRequest,
  type SendOutcome
} from '@shared/contract';

const DEFAULT_TIMEOUT_MS = 10_000;

/** 사내망 SSL 인터셉션 등 흔한 네트워크 오류를 알기 쉬운 문장으로 바꾼다. */
export function describeNetworkError(e: unknown, timeoutMs: number): string {
  const err = e as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return `${timeoutMs}ms 안에 응답이 없음(타임아웃)`;
  const code = err?.cause?.code;
  switch (code) {
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
      return `인증서를 신뢰할 수 없음(${code}). 사내망 SSL 인터셉션이면 NODE_EXTRA_CA_CERTS에 CA 번들을 지정해야 함`;
    case 'ENOTFOUND':
      return '서버 주소를 찾을 수 없음(ENOTFOUND)';
    case 'ECONNREFUSED':
      return '서버가 연결을 거부함(ECONNREFUSED)';
    case 'ECONNRESET':
      return '서버가 연결을 끊음(ECONNRESET)';
  }
  return err?.cause?.message ?? err?.message ?? String(e);
}

async function send(request: PlannedRequest, timeoutMs: number) {
  const body = request.body
    ? request.body.encoding === 'base64'
      ? Buffer.from(request.body.content, 'base64')
      : request.body.content
    : undefined;
  const started = Date.now();
  const res = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs)
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { res, buf, durationMs: Date.now() - started };
}

/** 화면에 돌려줄 응답 본문 최대 크기. */
const MAX_SEND_BODY_BYTES = 2_000_000;

const isTextual = (contentType: string | null): boolean =>
  !contentType || /(^text\/|json|xml|javascript|x-www-form-urlencoded|html|svg)/i.test(contentType);

/**
 * 컬렉션에서 요청 하나를 그대로 보내고 응답을 돌려준다(검증 없음). 직접 누른 전송이라 "재현 불가/위험 메서드" 제한은 걸지 않는다
 * (위험 메서드 확인은 화면에서 한다). 변수 누락이나 서버 미지정은 오류로 알린다.
 */
export async function sendRequest(contract: Contract, options: ContractRunOptions): Promise<SendOutcome> {
  const plan = planRequest({ ...contract, verifiable: true, safeToRun: true }, { ...options, allowUnsafe: true });
  if (!plan.ok) return { ok: false, error: plan.reason };
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const { res, buf, durationMs } = await send(plan.request, timeoutMs);
    const contentType = res.headers.get('content-type');
    const truncated = buf.length > MAX_SEND_BODY_BYTES;
    const slice = truncated ? buf.subarray(0, MAX_SEND_BODY_BYTES) : buf;
    const textual = isTextual(contentType);
    return {
      ok: true,
      method: plan.request.method,
      url: plan.request.url,
      status: res.status,
      statusText: res.statusText,
      headers: [...res.headers.entries()],
      body: textual ? slice.toString('utf-8') : truncated ? '' : slice.toString('base64'),
      bodyEncoding: textual ? 'text' : 'base64',
      truncated,
      sizeBytes: buf.length,
      durationMs,
      omittedHeaders: plan.omittedHeaders
    };
  } catch (e) {
    return { ok: false, error: describeNetworkError(e, timeoutMs) };
  }
}
