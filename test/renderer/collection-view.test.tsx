import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import type { Contract, SendOutcome } from '../../src/shared/contract';

vi.mock('../../src/renderer/src/components/code/CodeView', () => ({
  CodeView: ({ value }: { value: string }) => <pre data-testid="code">{value}</pre>
}));

import { CollectionView, type CollectionViewProps } from '../../src/renderer/src/components/collection/CollectionView';
import { isDisabled } from './disabled-helper';

const contract = (name: string, over: Partial<Contract> = {}): Contract => ({
  version: 1,
  id: name,
  endpointId: `GET /${name}`,
  name,
  source: { capturedAt: 1, origin: 'https://api.example.com' },
  request: { method: 'GET', urlTemplate: `{{baseUrl}}/${name}`, query: [['page', '1']], headers: [['Authorization', '{{token}}']] },
  expect: { status: 200, headers: [] },
  verifiable: true,
  safeToRun: true,
  ...over
});

const ok: SendOutcome = {
  ok: true,
  method: 'GET',
  url: 'https://api.example.com/users?page=1',
  status: 200,
  statusText: 'OK',
  headers: [['content-type', 'application/json']],
  body: '{"id":1}',
  bodyEncoding: 'text',
  truncated: false,
  sizeBytes: 8,
  durationMs: 42,
  omittedHeaders: []
};

const send = vi.fn();
const importBruno = vi.fn();
const exportBruno = vi.fn();

beforeEach(() => {
  send.mockReset().mockResolvedValue(ok);
  importBruno.mockReset();
  exportBruno.mockReset();
  (window as unknown as { mokerApi: unknown }).mokerApi = { contract: { send, importBruno, exportBruno } };
});

function setup(over: Partial<CollectionViewProps> = {}) {
  const props: CollectionViewProps = {
    projectOpen: true,
    projectName: 'cci',
    contracts: [contract('users'), contract('login', { request: { method: 'POST', urlTemplate: '{{baseUrl}}/login', query: [], headers: [], body: { encoding: 'text', content: '{}' } }, safeToRun: false })],
    servers: [{ name: 'dev', baseUrl: 'https://dev.example.com' }],
    onCreate: vi.fn().mockResolvedValue('새 요청'),
    onSave: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn(),
    onImport: vi.fn().mockResolvedValue({ saved: 2, merged: 0 }),
    onUpsertServer: vi.fn().mockResolvedValue(true),
    onRemoveServer: vi.fn(),
    ...over
  };
  render(<CollectionView {...props} />);
  return props;
}

describe('CollectionView', () => {
  it('프로젝트가 없으면 안내만 보여 준다', () => {
    setup({ projectOpen: false });
    expect(screen.getByText(/프로젝트를 열어야 컬렉션/)).toBeTruthy();
  });

  it('서버별 폴더 아래에 요청을 보여 주고, 고르면 편집기가 열린다', () => {
    setup();
    const tree = screen.getByRole('complementary', { name: '컬렉션 요청' });
    expect(within(tree).getByText('api.example.com')).toBeTruthy();
    fireEvent.click(within(tree).getByText('/users'));
    expect((screen.getByLabelText('URL') as HTMLInputElement).value).toBe('{{baseUrl}}/users?page=1');
    expect((screen.getByLabelText('메서드') as HTMLSelectElement).value).toBe('GET');
  });

  it('보내기: 변수와 선택한 서버로 요청하고 응답을 보여 준다', async () => {
    setup();
    fireEvent.click(screen.getByText('/users'));
    fireEvent.click(screen.getByRole('tab', { name: /변수/ }));
    fireEvent.change(screen.getByLabelText('변수 token'), { target: { value: 'Bearer t' } });
    fireEvent.change(screen.getByLabelText('보낼 서버'), { target: { value: 'dev' } });
    fireEvent.click(screen.getByText('보내기'));

    await waitFor(() => expect(send).toHaveBeenCalled());
    const [sent, options] = send.mock.calls[0];
    expect(sent.name).toBe('users');
    expect(options).toEqual({ baseUrl: 'https://dev.example.com', hostMap: { 'https://api.example.com': 'https://dev.example.com' }, vars: { token: 'Bearer t' } });
    expect(await screen.findByText('200 OK')).toBeTruthy();
    expect(screen.getByText('42 ms')).toBeTruthy();
    expect(screen.getByTestId('code').textContent).toContain('"id": 1');
  });

  it('실패 응답과 오류를 구분해 보여 준다', async () => {
    send.mockResolvedValueOnce({ ok: false, error: '변수 값이 필요함: token' });
    setup();
    fireEvent.click(screen.getByText('/users'));
    fireEvent.click(screen.getByText('보내기'));
    expect(await screen.findByText(/변수 값이 필요함/)).toBeTruthy();
  });

  it('GET이 아닌 요청은 확인 후에만 보낸다', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    setup();
    fireEvent.click(screen.getByText('/login'));
    fireEvent.click(screen.getByText('보내기'));
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('보내기'));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    confirm.mockRestore();
  });

  it('고치면 저장 버튼이 켜지고 저장하면 편집본이 전달된다', async () => {
    const props = setup();
    fireEvent.click(screen.getByText('/users'));
    const save = screen.getByText(/^저장/).closest('button') as HTMLButtonElement;
    expect(isDisabled(save)).toBe(true);
    fireEvent.change(screen.getByLabelText('메서드'), { target: { value: 'DELETE' } });
    expect(isDisabled(save)).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(props.onSave).toHaveBeenCalled());
    const saved = (props.onSave as ReturnType<typeof vi.fn>).mock.calls[0][0] as Contract;
    expect(saved.request.method).toBe('DELETE');
    expect(saved.safeToRun).toBe(false);
  });

  it('새 요청 만들기와 Bruno 가져오기/내보내기', async () => {
    importBruno.mockResolvedValue({ contracts: [contract('a'), contract('b')], notes: [], skippedFiles: 0 });
    exportBruno.mockResolvedValue({ dir: '/tmp/out', files: 2, merged: false, added: 2, existing: 0 });
    const props = setup();
    fireEvent.click(screen.getByLabelText('새 요청'));
    await waitFor(() => expect(props.onCreate).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('Bruno 가져오기'));
    await waitFor(() => expect(props.onImport).toHaveBeenCalled());
    expect(await screen.findByText(/새 요청 2개/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Bruno 내보내기'));
    await waitFor(() => expect(exportBruno).toHaveBeenCalledWith('cci', expect.any(Array), expect.any(Array)));
  });

  it('우클릭 메뉴: 모든 항목에 아이콘이 있고 삭제가 동작한다', () => {
    const props = setup();
    fireEvent.contextMenu(screen.getByText('/users'));
    const menu = screen.getByRole('menu');
    for (const row of within(menu).getAllByRole('menuitem')) expect(row.querySelector('svg')).toBeTruthy();
    fireEvent.click(within(menu).getByText('삭제'));
    expect(props.onRemove).toHaveBeenCalledWith('users');
  });
});
