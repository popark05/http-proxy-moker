/**
 * CapturedExchange ↔ HAR 1.2 변환.
 * HTTPToolkit(reference/httptoolkit-ui/src/model/http/har.ts) 패턴 참고(자체 구현):
 * - 표준 HAR 1.2 + `_` 프리픽스 커스텀 필드(encodedLength/base64 body 등)
 * - body는 텍스트면 content.text, 이진이면 base64(encoding='base64')
 * - 원본 바이트 길이(encodedLength) 보존
 */

import type {
  CapturedBody,
  CapturedExchange,
  CapturedRequest,
  CapturedResponse
} from './capture';

export interface HarHeader {
  name: string;
  value: string;
}

export interface HarContent {
  size: number;
  mimeType: string;
  text?: string;
  encoding?: 'base64';
  /** 커스텀: 원본 인코딩 여부 표시(omitted 등). */
  _status?: CapturedBody['encoding'];
}

export interface HarPostData {
  mimeType: string;
  text?: string;
  encoding?: 'base64';
  _status?: CapturedBody['encoding'];
}

export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: HarHeader[];
    queryString: HarHeader[];
    headersSize: number;
    bodySize: number;
    postData?: HarPostData;
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    headers: HarHeader[];
    content: HarContent;
    redirectURL: string;
    headersSize: number;
    bodySize: number;
  };
  cache: Record<string, never>;
  timings: { send: number; wait: number; receive: number };
  /** 커스텀: exchange id 보존(라운드트립용). */
  _id: string;
  /** 커스텀: 응답 없음/중단 표시. */
  _responseState?: 'pending' | 'aborted';
  /** 커스텀: 목적지. */
  _destination?: string;
  /** 커스텀: QA 태그. */
  _tags?: string[];
}

export interface Har {
  log: {
    version: '1.2';
    creator: { name: string; version: string };
    entries: HarEntry[];
  };
}

const CREATOR = { name: 'MokerProxy', version: '0.1.0' } as const;

function headersToHar(headers: Array<[string, string]>): HarHeader[] {
  return headers.map(([name, value]) => ({ name, value }));
}

function harToHeaders(headers: HarHeader[]): Array<[string, string]> {
  return headers.map((h) => [h.name, h.value]);
}

function headerValue(headers: Array<[string, string]>, name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers.find(([k]) => k.toLowerCase() === lower)?.[1];
}

/** CapturedBody → HAR postData(요청용). */
function bodyToPostData(body: CapturedBody): HarPostData | undefined {
  if (body.encoding === 'empty') return undefined;
  const mimeType = body.contentType ?? 'application/octet-stream';
  if (body.encoding === 'omitted') {
    return { mimeType, _status: 'omitted' };
  }
  if (body.encoding === 'base64') {
    return { mimeType, text: body.content, encoding: 'base64', _status: 'base64' };
  }
  return { mimeType, text: body.content, _status: 'text' };
}

/** CapturedBody → HAR content(응답용). */
function bodyToContent(body: CapturedBody): HarContent {
  const mimeType = body.contentType ?? 'application/octet-stream';
  const base: HarContent = { size: body.byteLength, mimeType, _status: body.encoding };
  if (body.encoding === 'text') return { ...base, text: body.content };
  if (body.encoding === 'base64') return { ...base, text: body.content, encoding: 'base64' };
  return base; // empty / omitted
}

/** HAR postData/content → CapturedBody. */
function harBodyToCaptured(
  status: CapturedBody['encoding'] | undefined,
  text: string | undefined,
  size: number,
  mimeType: string | undefined
): CapturedBody {
  const contentType = mimeType;
  const effective = status ?? (text === undefined ? 'empty' : 'text');
  switch (effective) {
    case 'empty':
      return { encoding: 'empty', content: '', byteLength: 0, contentType };
    case 'omitted':
      return { encoding: 'omitted', content: '', byteLength: size, contentType };
    case 'base64':
      return { encoding: 'base64', content: text ?? '', byteLength: size, contentType };
    default:
      return {
        encoding: 'text',
        content: text ?? '',
        byteLength: size || Buffer.byteLength(text ?? '', 'utf-8'),
        contentType
      };
  }
}

function queryStringOf(url: string): HarHeader[] {
  try {
    const parsed = new URL(url);
    return Array.from(parsed.searchParams.entries()).map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

export function exchangeToHarEntry(exchange: CapturedExchange): HarEntry {
  const { request, response } = exchange;
  const postData = bodyToPostData(request.body);

  const entry: HarEntry = {
    startedDateTime: new Date(exchange.startedAt).toISOString(),
    time: 0,
    request: {
      method: request.method,
      url: request.url,
      httpVersion: 'HTTP/1.1',
      headers: headersToHar(request.headers),
      queryString: queryStringOf(request.url),
      headersSize: -1,
      bodySize: request.body.byteLength,
      ...(postData ? { postData } : {})
    },
    response:
      response && response !== 'aborted'
        ? {
            status: response.statusCode,
            statusText: response.statusMessage,
            httpVersion: 'HTTP/1.1',
            headers: headersToHar(response.headers),
            content: bodyToContent(response.body),
            redirectURL: '',
            headersSize: -1,
            bodySize: response.body.byteLength
          }
        : {
            status: 0,
            statusText: '',
            httpVersion: 'HTTP/1.1',
            headers: [],
            content: { size: 0, mimeType: 'application/x-unknown' },
            redirectURL: '',
            headersSize: -1,
            bodySize: -1
          },
    cache: {},
    timings: { send: -1, wait: -1, receive: -1 },
    _id: exchange.id,
    ...(response === 'aborted'
      ? { _responseState: 'aborted' as const }
      : !response
        ? { _responseState: 'pending' as const }
        : {}),
    ...(request.destination ? { _destination: request.destination } : {}),
    ...(exchange.tags && exchange.tags.length > 0 ? { _tags: exchange.tags } : {})
  };

  return entry;
}

export function harEntryToExchange(entry: HarEntry): CapturedExchange {
  const request: CapturedRequest = {
    method: entry.request.method,
    url: entry.request.url,
    path: (() => {
      try {
        const u = new URL(entry.request.url);
        return u.pathname + u.search;
      } catch {
        return entry.request.url;
      }
    })(),
    headers: harToHeaders(entry.request.headers),
    destination: entry._destination,
    body: entry.request.postData
      ? harBodyToCaptured(
          entry.request.postData._status,
          entry.request.postData.text,
          entry.request.bodySize >= 0 ? entry.request.bodySize : 0,
          entry.request.postData.mimeType
        )
      : { encoding: 'empty', content: '', byteLength: 0 }
  };

  let response: CapturedResponse | 'aborted' | undefined;
  if (entry._responseState === 'aborted') {
    response = 'aborted';
  } else if (entry._responseState === 'pending' || entry.response.status === 0) {
    response = undefined;
  } else {
    response = {
      statusCode: entry.response.status,
      statusMessage: entry.response.statusText,
      headers: harToHeaders(entry.response.headers),
      body: harBodyToCaptured(
        entry.response.content._status,
        entry.response.content.text,
        entry.response.content.size,
        entry.response.content.mimeType ?? headerValue(harToHeaders(entry.response.headers), 'content-type')
      )
    };
  }

  return {
    id: entry._id,
    startedAt: Date.parse(entry.startedDateTime) || Date.now(),
    request,
    response,
    ...(entry._tags && entry._tags.length > 0 ? { tags: entry._tags } : {})
  };
}

export function exchangesToHar(exchanges: CapturedExchange[]): Har {
  return {
    log: {
      version: '1.2',
      creator: { ...CREATOR },
      entries: exchanges.map(exchangeToHarEntry)
    }
  };
}

export function harToExchanges(har: Har): CapturedExchange[] {
  return (har.log?.entries ?? []).map(harEntryToExchange);
}
