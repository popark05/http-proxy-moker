import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CapturedBody } from '../../src/shared/capture';

// Monaco는 jsdom에서 불필요하므로 코드 뷰는 대역으로 대체한다.
vi.mock('../../src/renderer/src/components/code/CodeView', () => ({
  CodeView: ({ value }: { value: string }) => <pre data-testid="code">{value}</pre>
}));

import { BodyView } from '../../src/renderer/src/components/traffic/BodyView';

const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');

describe('BodyView 이미지 본문', () => {
  it('image/png base64 본문을 <img>로 그린다', () => {
    const body: CapturedBody = { encoding: 'base64', content: PNG_B64, byteLength: 2158, contentType: 'image/png' };
    render(<BodyView body={body} />);
    const img = screen.getByAltText('응답 본문 이미지') as HTMLImageElement;
    expect(img.src).toBe(`data:image/png;base64,${PNG_B64}`);
    expect(screen.getByText(/PNG/)).toBeTruthy();
    expect(screen.getByText(/2\.1 KB/)).toBeTruthy();
  });

  it('로드 실패하면 안내 문구', () => {
    const body: CapturedBody = { encoding: 'base64', content: PNG_B64, byteLength: 12, contentType: 'image/png' };
    render(<BodyView body={body} />);
    fireEvent.error(screen.getByAltText('응답 본문 이미지'));
    expect(screen.getByText(/이미지를 표시할 수 없습니다/)).toBeTruthy();
  });

  it('이미지가 아닌 이진 본문은 기존 안내를 유지', () => {
    const body: CapturedBody = { encoding: 'base64', content: 'AAEC', byteLength: 3, contentType: 'application/pdf' };
    render(<BodyView body={body} />);
    expect(screen.getByText(/이진 본문/)).toBeTruthy();
  });

  it('SVG 텍스트는 미리보기와 소스를 전환', () => {
    const body: CapturedBody = { encoding: 'text', content: '<svg/>', byteLength: 6, contentType: 'image/svg+xml' };
    render(<BodyView body={body} />);
    expect(screen.getByAltText('응답 본문 이미지')).toBeTruthy();
    fireEvent.click(screen.getByText('소스'));
    expect(screen.getByTestId('code').textContent).toBe('<svg/>');
  });

  it('HTML 본문은 격리된 iframe으로 렌더링하고 코드 보기로 전환할 수 있다', () => {
    const html = '<!doctype html><html><body><script>alert(1)</script><h1>안녕</h1></body></html>';
    const body: CapturedBody = { encoding: 'text', content: html, byteLength: html.length, contentType: 'text/html' };
    render(<BodyView body={body} />);
    const frame = screen.getByTitle('HTML 응답 렌더링') as HTMLIFrameElement;
    // sandbox 속성이 빈 값 = 스크립트/same-origin/폼/팝업 모두 금지.
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toBe(html);

    fireEvent.click(screen.getByText('코드'));
    expect(screen.getByTestId('code').textContent).toBe(html);
    expect(screen.queryByTitle('HTML 응답 렌더링')).toBeNull();
  });

  it('JSON 본문은 HTML 렌더링 대상이 아니다', () => {
    const body: CapturedBody = { encoding: 'text', content: '{"a":1}', byteLength: 7, contentType: 'application/json' };
    render(<BodyView body={body} />);
    expect(screen.queryByTitle('HTML 응답 렌더링')).toBeNull();
    expect(screen.getByTestId('code')).toBeTruthy();
  });
});
