import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ContractModal } from '../../src/renderer/src/components/contract/ContractModal';
import type { Contract, ContractRunResult } from '../../src/shared/contract';

const contract = (name: string, over: Partial<Contract> = {}): Contract => ({
  version: 1,
  id: name,
  endpointId: `GET /${name}`,
  name,
  request: {
    method: 'GET',
    urlTemplate: '{{baseUrl}}/' + name,
    query: [],
    headers: [['Authorization', '{{authorization}}']]
  },
  expect: { status: 200, headers: [] },
  verifiable: true,
  safeToRun: true,
  source: { capturedAt: 1, origin: 'https://api.example.com' },
  ...over
});

function setup(servers = [{ name: 'dev', baseUrl: 'https://dev.example.com' }], contracts = [contract('users')]) {
  const run = vi.fn(async (): Promise<ContractRunResult[]> => [
    {
      contractName: 'users',
      endpointId: 'GET /users',
      status: 'failed',
      httpStatus: 200,
      durationMs: 12,
      violations: [{ path: '$.id', message: '숫자여야 함 (실제: 문자열)' }]
    }
  ]);
  (window as unknown as { mokerApi: unknown }).mokerApi = { contract: { run, onResult: () => () => {} } };
  render(
    <ContractModal
      open
      onOpenChange={() => {}}
      contracts={contracts}
      servers={servers}
      onRemoveContract={() => {}}
      onUpsertServer={async () => true}
      onRemoveServer={() => {}}
    />
  );
  return { run };
}

describe('ContractModal', () => {
  beforeEach(() => {
    (window as unknown as { mokerApi: unknown }).mokerApi = undefined;
  });

  it('서버와 변수를 넣어 실행하고 위반을 보여준다', async () => {
    const { run } = setup();
    fireEvent.change(screen.getByLabelText('변수 authorization'), { target: { value: 'Bearer t' } });
    fireEvent.click(screen.getByRole('button', { name: /1개 실행/ }));
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith([expect.objectContaining({ name: 'users' })], {
      hostMap: {},
      vars: { authorization: 'Bearer t' },
      allowUnsafe: false
    });
    expect(await screen.findByText('$.id')).toBeTruthy();
    expect(screen.getByText(/실패 1/)).toBeTruthy();
  });

  it('기본은 캡처한 서버로 보내고, 등록 서버를 고르면 그 주소로 바꾼다', async () => {
    const { run } = setup();
    expect(screen.getByText('https://api.example.com')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('https://api.example.com 보낼 서버'), { target: { value: 'dev' } });
    fireEvent.click(screen.getByRole('button', { name: /1개 실행/ }));
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ hostMap: { 'https://api.example.com': 'https://dev.example.com' } }));
  });

  it('등록된 서버가 없어도 실행할 수 있다', () => {
    setup([]);
    expect((screen.getByRole('button', { name: /1개 실행/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('운영 서버는 확인을 거절하면 실행하지 않는다', () => {
    const { run } = setup([{ name: 'prod', baseUrl: 'https://api.example.com' }]);
    fireEvent.change(screen.getByLabelText('https://api.example.com 보낼 서버'), { target: { value: 'prod' } });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: /1개 실행/ }));
    expect(run).not.toHaveBeenCalled();
  });
});
