import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Workspace } from '../../src/renderer/src/components/layout/Workspace';
import type { Tab } from '../../src/renderer/src/lib/workbench';

const tab = (target: Tab['target'], key: string): Tab => ({ key, target, pinned: true });

function Draft({ label }: { label: string }): React.JSX.Element {
  const [value, setValue] = useState('');
  return <input aria-label={label} value={value} onChange={(e) => setValue(e.target.value)} />;
}

function Harness({ tabs, activeKey }: { tabs: Tab[]; activeKey: string }): React.JSX.Element {
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
  const a = tab({ kind: 'exchange', id: 'a' }, 'exchange:a');
  const b = tab({ kind: 'exchange', id: 'b' }, 'exchange:b');

  it('요청 상세 탭은 활성일 때만 그린다', () => {
    const tabs = [a, b];
    const { rerender } = render(<Harness tabs={tabs} activeKey="exchange:a" />);
    expect(screen.queryByLabelText('exchange:a', { selector: 'input' })).not.toBeNull();
    expect(screen.queryByLabelText('exchange:b', { selector: 'input' })).toBeNull();
    rerender(<Harness tabs={tabs} activeKey="exchange:b" />);
    expect(screen.queryByLabelText('exchange:a', { selector: 'input' })).toBeNull();
    expect(screen.queryByLabelText('exchange:b', { selector: 'input' })).not.toBeNull();
  });

  it('탭이 없으면 빈 상태를 보여 준다', () => {
    render(<Harness tabs={[]} activeKey="" />);
    expect(screen.getByText('열린 탭이 없습니다')).toBeTruthy();
  });
});
