import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Workspace } from '../../src/renderer/src/components/layout/Workspace';
import type { Tab } from '../../src/renderer/src/lib/workbench';

const tab = (target: Tab['target'], key: string): Tab => ({ key, target, pinned: true });

function Draft({ label }: { label: string }): JSX.Element {
  const [value, setValue] = useState('');
  return <input aria-label={label} value={value} onChange={(e) => setValue(e.target.value)} />;
}

function Harness({ tabs, activeKey }: { tabs: Tab[]; activeKey: string }): JSX.Element {
  return (
    <Workspace
      tabs={tabs}
      activeKey={activeKey}
      tabBarProps={{
        describe: (t) => ({ label: t.key }),
        onActivate: () => {},
        onClose: () => {},
        onPin: () => {},
        onMove: () => {}
      }}
      renderContent={(t) => <Draft label={t.key} />}
    />
  );
}

describe('Workspace', () => {
  const editor = tab({ kind: 'scenario', name: 'A' }, 'scenario:A');
  const library = tab({ kind: 'library' }, 'library');
  const exchange = tab({ kind: 'exchange', id: 'x' }, 'exchange:x');

  it('편집 탭은 다른 탭으로 옮겨도 입력 중인 내용이 유지된다', () => {
    const tabs = [editor, library];
    const { rerender } = render(<Harness tabs={tabs} activeKey="scenario:A" />);
    fireEvent.change(screen.getByLabelText('scenario:A'), { target: { value: '작성 중' } });

    rerender(<Harness tabs={tabs} activeKey="library" />);
    expect(screen.getByLabelText('scenario:A', { selector: 'input' }).closest('[hidden]')).not.toBeNull();

    rerender(<Harness tabs={tabs} activeKey="scenario:A" />);
    expect((screen.getByLabelText('scenario:A') as HTMLInputElement).value).toBe('작성 중');
  });

  it('요청 상세 탭은 활성일 때만 그린다', () => {
    const tabs = [exchange, library];
    const { rerender } = render(<Harness tabs={tabs} activeKey="exchange:x" />);
    expect(screen.queryByLabelText('exchange:x')).not.toBeNull();
    rerender(<Harness tabs={tabs} activeKey="library" />);
    expect(screen.queryByLabelText('exchange:x')).toBeNull();
  });

  it('탭이 없으면 빈 상태를 보여 준다', () => {
    render(<Harness tabs={[]} activeKey="" />);
    expect(screen.getByText('열린 탭이 없습니다')).toBeTruthy();
  });
});
