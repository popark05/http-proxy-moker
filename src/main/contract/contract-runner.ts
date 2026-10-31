/**
 * 계약 실행기: 계약의 요청을 실제 서버로 보내고 응답을 검증한다.
 * 프록시 워커(순정 Node, OpenSSL)에서 실행한다 — Electron main의 TLS(BoringSSL)는 mockttp와 같은 이유로 쓰지 않는다.
 */
import {
  checkResponse,
  planRequest,
  type Contract,
  type ContractRunOptions,
  type ContractRunResult,
  type PlannedRequest
} from '@shared/contract';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CONCURRENCY = 4;
/** 검증에 쓰는 본문 최대 크기(이보다 크면 모양 검증을 못 하므로 오류로 보고). */
const MAX_BODY_BYTES = 5_000_000;

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

/** 계약 하나를 실행한다. 예외를 던지지 않고 결과로 돌려준다. */
export async function runContract(contract: Contract, options: ContractRunOptions): Promise<ContractRunResult> {
  const base = { contractName: contract.name, endpointId: contract.endpointId, violations: [] };
  const plan = planRequest(contract, options);
  if (!plan.ok) return { ...base, status: 'skipped', reason: plan.reason };

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const { res, buf, durationMs } = await send(plan.request, timeoutMs);
    if (buf.length > MAX_BODY_BYTES) {
      return { ...base, status: 'error', reason: '응답이 너무 커서 검증할 수 없음', httpStatus: res.status, durationMs };
    }
    const check = checkResponse(contract.expect, {
      status: res.status,
      headers: [...res.headers.entries()],
      body: buf.toString('utf-8')
    });
    return {
      ...base,
      ...(plan.omittedHeaders.length > 0 ? { reason: `값이 없어 헤더 생략: ${plan.omittedHeaders.join(', ')}` } : {}),
      status: check.passed ? 'passed' : 'failed',
      violations: check.violations,
      httpStatus: res.status,
      durationMs
    };
  } catch (e) {
    return { ...base, status: 'error', reason: describeNetworkError(e, timeoutMs) };
  }
}

/** 계약 여러 개를 동시 실행 수 제한 안에서 실행한다. 결과는 입력 순서를 유지하고 하나 끝날 때마다 onResult를 부른다. */
export async function runContracts(
  contracts: Contract[],
  options: ContractRunOptions,
  onResult?: (result: ContractRunResult) => void
): Promise<ContractRunResult[]> {
  const results: ContractRunResult[] = new Array(contracts.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < contracts.length) {
      const i = next++;
      results[i] = await runContract(contracts[i], options);
      onResult?.(results[i]);
    }
  };
  const n = Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, contracts.length));
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}
