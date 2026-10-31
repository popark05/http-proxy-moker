import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MockingView, type MockingTab } from '../../src/renderer/src/components/mock/MockingView';

function Draft({ label }: { label: string }): JSX.Element {
  const [value, setValue] = useState('');
  return <input aria-label={label} value={value} onChange={(e) => setValue(e.target.value)} />;
}

function Harness({ initial = 'mocks', active, dirty = false }: { initial?: MockingTab; active?: string; dirty?: boolean }): JSX.Element {
  const [tab, setTab] = useState<MockingTab>(initial);
  return (
    <MockingView
      tab={tab}
      onTabChange={setTab}
      counts={{ mocks: 3, scenarios: 2, cases: 5 }}
      activeScenario={active}
      scenarioDirty={dirty}
      mocks={<Draft label="목 입력" />}
      scenarios={<Draft label="시나리오 입력" />}
      library={<Draft label="케이스 입력" />}
    />
  );
}

describe('MockingView', () => {
  it('현재 목 / 시나리오 / 응답 케이스 탭과 개수를 보여 준다', () => {
    render(<Harness />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['현재 목 3', '시나리오 2', '응답 케이스 5']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('탭을 옮겨도 편집 중인 입력이 사라지지 않는다(숨겨 둘 뿐)', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('목 입력'), { target: { value: '작성 중' } });
    fireEvent.click(screen.getByRole('tab', { name: /시나리오/ }));
    expect(screen.getByLabelText('목 입력').closest('[hidden]')).not.toBeNull();
    expect(screen.getByLabelText('시나리오 입력').closest('[hidden]')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /현재 목/ }));
    expect((screen.getByLabelText('목 입력') as HTMLInputElement).value).toBe('작성 중');
  });

  it('활성 시나리오와 수정됨 표시를 머리에 보여 준다', () => {
    const { rerender } = render(<Harness />);
    expect(screen.getByText('활성 시나리오 없음')).toBeTruthy();
    rerender(<Harness active="결제 실패" dirty />);
    expect(screen.getByText(/활성: 결제 실패 · 수정됨/)).toBeTruthy();
  });

  it('탭과 패널이 aria로 이어진다', () => {
    render(<Harness initial="library" />);
    const tab = screen.getByRole('tab', { name: /응답 케이스/ });
    const panel = document.getElementById(tab.getAttribute('aria-controls')!)!;
    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(panel.hasAttribute('hidden')).toBe(false);
    void vi;
  });
});
