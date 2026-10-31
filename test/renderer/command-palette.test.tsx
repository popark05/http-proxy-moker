import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('CommandPalette', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const input = (): HTMLElement => screen.getByRole('combobox');

  it('열리면 그룹별로 항목을 보여 주고 첫 항목이 선택되어 있다', () => {
    const { commands } = make();
    render(<CommandPalette open onOpenChange={() => {}} commands={commands} />);
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('되돌릴 수 없음')).toBeTruthy();
  });

  it('입력으로 거르고 Enter로 선택한 항목을 실행한 뒤 닫는다', () => {
    const { commands, runs } = make();
    const onOpenChange = vi.fn();
    render(<CommandPalette open onOpenChange={onOpenChange} commands={commands} />);
    fireEvent.change(input(), { target: { value: '프록시' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    act(() => vi.runAllTimers());
    expect(runs.login).toHaveBeenCalledTimes(1);
  });

  it('방향키로 선택을 옮기고(양 끝에서 순환) Enter로 실행한다', () => {
    const { commands, runs } = make();
    render(<CommandPalette open onOpenChange={() => {}} commands={commands} />);
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(screen.getAllByRole('option')[2].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input(), { key: 'Enter' });
    act(() => vi.runAllTimers());
    expect(runs.login).toHaveBeenCalled();
  });

  it('클릭으로도 실행하고, 일치 항목이 없으면 안내하며 Enter는 아무것도 하지 않는다', () => {
    const { commands, runs } = make();
    render(<CommandPalette open onOpenChange={() => {}} commands={commands} />);
    fireEvent.click(screen.getByText('캡처 지우기'));
    act(() => vi.runAllTimers());
    expect(runs.clear).toHaveBeenCalled();

    fireEvent.change(input(), { target: { value: '없는 명령' } });
    expect(screen.getByText('일치하는 항목이 없습니다')).toBeTruthy();
    fireEvent.keyDown(input(), { key: 'Enter' });
    act(() => vi.runAllTimers());
    expect(runs.login).not.toHaveBeenCalled();
  });
});
