import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge, statusTone, methodTone } from '../../src/renderer/src/components/primitives';

describe('statusTone', () => {
  it('2xx=success, 3xx=info, 4xx=warning, 5xx=error', () => {
    expect(statusTone(200)).toBe('success');
    expect(statusTone(301)).toBe('info');
    expect(statusTone(404)).toBe('warning');
    expect(statusTone(500)).toBe('error');
    expect(statusTone(0)).toBe('neutral');
  });
});

describe('methodTone', () => {
  it('메서드별 톤을 매핑한다(대소문자 무시)', () => {
    expect(methodTone('get')).toBe('info');
    expect(methodTone('POST')).toBe('success');
    expect(methodTone('PUT')).toBe('warning');
    expect(methodTone('DELETE')).toBe('error');
    expect(methodTone('TRACE')).toBe('neutral');
  });
});

describe('Badge', () => {
  it('자식 텍스트를 렌더한다(색만이 아니라 텍스트 병기 - 접근성)', () => {
    render(<Badge $tone="error">500</Badge>);
    expect(screen.getByText('500')).toBeInTheDocument();
  });
});
