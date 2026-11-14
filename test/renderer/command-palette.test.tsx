import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommandPalette } from '../../src/renderer/src/components/layout/CommandPalette';
import type { Command } from '../../src/renderer/src/lib/commands';

const make = (): { commands: Command[]; runs: Record<string, ReturnType<typeof vi.fn>> } => {
  const runs = { users: vi.fn(), login: vi.fn(), clear: vi.fn() };
  return {
    runs,
    commands: [
      { id: 'a', group: '이동', label: '트래픽 보기', run: runs.users },
      { id: 'b', group: '동작', label: '캡처 지우기', hint: '되돌릴 수 없음', run: runs.clear },
      { id: 'c', group: '동작', label: '프록시 시작', run: runs.login }
    ]
  };
};

// Astryx 팔레트는 검색 결과를 비동기로 채우므로 실제 타이머를 쓰고 waitFor로 기다린다.
const options = async (count?: number): Promise<HTMLElement[]> => {
  await waitFor(() => {
    const found = screen.getAllByRole('option');
    if (count !== undefined && found.length !== count) throw new Error(`옵션 ${found.length}개`);
  });
  return screen.getAllByRole('option');
};
const input = (): HTMLElement => screen.getByRole('combobox');

describe('CommandPalette', () => {
  it('열리면 모든 항목을 그룹별로 보여 준다', async () => {
    const { commands } = make();
    render(<CommandPalette open onOpenChange={() => {}} commands={commands} />);
    expect(await options(3)).toHaveLength(3);
    expect(screen.getByText('되돌릴 수 없음')).toBeTruthy();
    expect(screen.getByText('이동')).toBeTruthy();
    expect(screen.getAllByText('동작').length).toBeGreaterThan(0);
  });

  it('입력으로 거르고 Enter만 눌러도 맨 위 결과를 실행한 뒤 닫는다', async () => {
    const { commands, runs } = make();
    const onOpenChange = vi.fn();
    render(<CommandPalette open onOpenChange={onOpenChange} commands={commands} />);
    await options(3);
    fireEvent.change(input(), { target: { value: '프록시' } });
    await options(1);
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(runs.login).toHaveBeenCalledTimes(1));
  });

  it('방향키로 항목을 옮기고 Enter로 그 항목을 실행한다', async () => {
    const { commands, runs } = make();
    render(<CommandPalette open onOpenChange={() => {}} commands={commands} />);
    await options(3);
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    await waitFor(() => expect(input().getAttribute('aria-activedescendant')).toBeTruthy());
    fireEvent.keyDown(input(), { key: 'Enter' });
    // 두 번째 항목(캡처 지우기)이 실행된다.
    await waitFor(() => expect(runs.clear).toHaveBeenCalledTimes(1));
    expect(runs.users).not.toHaveBeenCalled();
  });

  it('클릭으로도 실행하고, 일치 항목이 없으면 안내하며 Enter는 아무것도 하지 않는다', async () => {
    const { commands, runs } = make();
    render(<CommandPalette open onOpenChange={() => {}} commands={commands} />);
    await options(3);
    fireEvent.click(screen.getByText('캡처 지우기'));
    await waitFor(() => expect(runs.clear).toHaveBeenCalled());

    fireEvent.change(input(), { target: { value: '없는 명령' } });
    expect(await screen.findByText('일치하는 항목이 없습니다')).toBeTruthy();
    fireEvent.keyDown(input(), { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 30));
    expect(runs.login).not.toHaveBeenCalled();
  });
});
