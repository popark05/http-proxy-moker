import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SplitPane } from '../../src/renderer/src/components/primitives/SplitPane';

const columns = (): string => (screen.getByRole('separator', { hidden: true }).parentElement as HTMLElement).style.gridTemplateColumns;

describe('SplitPane', () => {
  beforeEach(() => localStorage.clear());

  it('접으면 좌측 폭이 0이 되지만 구분선은 그리드 칸을 지켜 오른쪽 내용이 밀려나지 않는다', () => {
    render(<SplitPane left={<span>좌</span>} right={<span>우</span>} collapsed />);
    expect(columns()).toBe('0px 0px 1fr');
    const separator = screen.getByRole('separator', { hidden: true });
    // display:none(hidden 속성)이면 자동 배치에서 칸이 사라져 오른쪽 내용이 폭 0인 칸으로 들어간다.
    expect(separator.hasAttribute('hidden')).toBe(false);
    expect(separator.style.visibility).toBe('hidden');
    expect(screen.getByText('우').parentElement?.previousElementSibling).toBe(separator);
  });

  it('펼쳐져 있으면 저장된 폭을 복원하고 범위로 제한한다', () => {
    localStorage.setItem('k', '5000');
    render(<SplitPane left={<span>좌</span>} right={<span>우</span>} widthStorageKey="k" maxLeftWidth={600} />);
    expect(columns()).toBe('600px 6px 1fr');
  });

  it('저장소 값이 잘못되면 기본 폭을 쓴다', () => {
    localStorage.setItem('k', 'abc');
    render(<SplitPane left={<span>좌</span>} right={<span>우</span>} widthStorageKey="k" initialLeftWidth={380} />);
    expect(columns()).toBe('380px 6px 1fr');
  });
});
