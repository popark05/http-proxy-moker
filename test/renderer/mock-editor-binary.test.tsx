import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { MockDefinition } from '../../src/shared/mock';

vi.mock('../../src/renderer/src/components/code/CodeView', () => ({
  CodeView: ({ value }: { value: string }) => <pre data-testid="code">{value}</pre>
}));
vi.mock('../../src/renderer/src/components/code/CodeDiffView', () => ({
  CodeDiffView: () => <div />
}));

// jsdom의 Blob에는 arrayBuffer()가 없어(Electron/Chromium에는 있음) FileReader로 보충한다.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

import { MockEditor } from '../../src/renderer/src/components/mock/MockEditor';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]).toString('base64');
const mock = (over: Partial<MockDefinition['response']> = {}): MockDefinition => ({
  id: 'm1',
  label: 'GET /logo.png',
  method: 'GET',
  path: '/logo.png',
  enabled: true,
  response: {
    status: 200,
    headers: [
      ['content-type', 'image/png'],
      ['content-length', '10']
    ],
    body: PNG,
    bodyEncoding: 'base64',
    ...over
  },
  originalBody: PNG
});

describe('MockEditor 이진 본문', () => {
  it('이미지 미리보기와 파일 교체 버튼을 보여주고 텍스트 편집기는 쓰지 않는다', () => {
    render(<MockEditor mock={mock()} open onOpenChange={() => {}} onSave={() => {}} />);
    expect(screen.getByAltText('응답 본문 이미지')).toBeTruthy();
    expect(screen.getByText('파일로 교체')).toBeTruthy();
    // 헤더 편집기(CodeView)는 있지만, 본문 자리에 base64 텍스트 편집기는 없어야 한다.
    expect(screen.queryAllByTestId('code').some((el) => el.textContent === PNG)).toBe(false);
  });

  it('저장해도 base64 본문과 인코딩이 그대로다', () => {
    const onSave = vi.fn();
    render(<MockEditor mock={mock()} open onOpenChange={() => {}} onSave={onSave} />);
    fireEvent.click(screen.getByText('저장'));
    const saved = onSave.mock.calls[0][0] as MockDefinition;
    expect(saved.response.body).toBe(PNG);
    expect(saved.response.bodyEncoding).toBe('base64');
  });

  it('숫자처럼 보이는 base64도 JSON으로 변형하지 않는다', () => {
    const onSave = vi.fn();
    render(<MockEditor mock={mock({ body: '1e5' })} open onOpenChange={() => {}} onSave={onSave} />);
    fireEvent.click(screen.getByText('저장'));
    expect((onSave.mock.calls[0][0] as MockDefinition).response.body).toBe('1e5');
  });

  it('파일로 교체하면 본문/Content-Type이 바뀌고 content-length는 제거된다', async () => {
    const onSave = vi.fn();
    const { container } = render(<MockEditor mock={mock()} open onOpenChange={() => {}} onSave={onSave} />);
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], 'new.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText(/원본에서 교체됨/)).toBeTruthy());
    fireEvent.click(screen.getByText('저장'));
    const saved = onSave.mock.calls[0][0] as MockDefinition;
    expect(saved.response.body).toBe('AQID');
    expect(saved.response.headers).toEqual([['content-type', 'image/jpeg']]);
    expect(container).toBeTruthy();
  });

  it('너무 큰 파일은 거절하고 본문을 유지한다', async () => {
    const onSave = vi.fn();
    render(<MockEditor mock={mock()} open onOpenChange={() => {}} onSave={onSave} />);
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const big = new File([new Uint8Array(3 * 1024 * 1024)], 'big.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [big] } });
    await waitFor(() => expect(screen.getByText(/파일이 너무 큽니다/)).toBeTruthy());
    fireEvent.click(screen.getByText('저장'));
    expect((onSave.mock.calls[0][0] as MockDefinition).response.body).toBe(PNG);
  });
});
