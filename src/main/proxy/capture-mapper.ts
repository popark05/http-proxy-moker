import type { CompletedRequest, CompletedResponse } from 'mockttp';
import type { CapturedRequest, CapturedResponse } from '@shared/capture';
import { encodeBody } from './body-encoding';

/** rawHeaders([name,value][])를 우선 쓰되, 없으면 headers 객체를 평탄화. */
function normalizeHeaders(
  rawHeaders: Array<[string, string]> | undefined,
  headers: Record<string, string | string[] | undefined>
): Array<[string, string]> {
  if (rawHeaders && rawHeaders.length > 0) return rawHeaders;
  const result: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) result.push([key, v]);
    } else {
      result.push([key, value]);
    }
  }
  return result;
}

function headerValue(headers: Array<[string, string]>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of headers) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

function formatDestination(
  destination: { hostname: string; port: number } | undefined
): string | undefined {
  if (!destination) return undefined;
  return `${destination.hostname}:${destination.port}`;
}

export async function mapRequest(request: CompletedRequest): Promise<CapturedRequest> {
  const headers = normalizeHeaders(request.rawHeaders, request.headers);
  const decoded = await request.body.getDecodedBuffer().catch(() => request.body.buffer);
  return {
    method: request.method,
    url: request.url,
    path: request.path,
    headers,
    destination: formatDestination(request.destination),
    body: encodeBody(decoded, headerValue(headers, 'content-type'))
  };
}

export async function mapResponse(response: CompletedResponse): Promise<CapturedResponse> {
  const headers = normalizeHeaders(response.rawHeaders, response.headers);
  const decoded = await response.body.getDecodedBuffer().catch(() => response.body.buffer);
  return {
    statusCode: response.statusCode,
    statusMessage: response.statusMessage,
    headers,
    body: encodeBody(decoded, headerValue(headers, 'content-type'))
  };
}
