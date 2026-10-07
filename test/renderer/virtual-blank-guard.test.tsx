import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { CapturedExchange } from '../../src/shared/capture';
import { TrafficGroupList } from '../../src/renderer/src/components/traffic/TrafficGroupList';
import { TrafficList } from '../../src/renderer/src/components/traffic/TrafficList';

const ex = (id: string, host: string): CapturedExchange => ({
  id,
  startedAt: 1,
  request: { method: 'GET', url: `https://${host}/p${id}`, path: `/p${id}`, headers: [], body: { encoding: 'empty', content: '', byteLength: 0 }, clientIp: '1.1.1.1' },
  response: undefined
});

const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
const original = {
  offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
  offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth'),
  clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight'),
  clientWidth: Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth'),
  rect: Element.prototype.getBoundingClientRect
};

/** jsdom은 레이아웃이 없으므로 요소 크기를 테스트가 정한다. */
function setSize(width: number, height: number): void {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => height });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => width });
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => height });
  Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get: () => width });
  Element.prototype.getBoundingClientRect = () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) });
}

afterEach(() => {
  for (const [key, desc] of Object.entries(original)) {
    if (key === 'rect') Element.prototype.getBoundingClientRect = original.rect;
    else if (desc) Object.defineProperty(key.startsWith('offset') ? HTMLElement.prototype : Element.prototype, key, desc);
    else delete proto[key];
  }
  vi.restoreAllMocks();
});

describe('가상 스크롤 보정(useVirtualBlankGuard)', () => {
  it('그룹 목록: 영역 크기를 놓쳐 행이 하나도 안 그려진 상태를 감지해 스스로 복구한다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setSize(0, 0); // 처음 측정 시 영역이 0 → 보이는 행 0개
    const exchanges = [ex('1', 'a.com'), ex('2', 'a.com'), ex('3', 'b.com')];
    render(<TrafficGroupList exchanges={exchanges} selectedId={undefined} onSelect={() => {}} checkedIds={new Set()} onCheckedChange={() => {}} />);
    expect(screen.queryByText('a.com')).toBeNull();

    setSize(400, 600); // 이후 실제 레이아웃이 생겼지만 이벤트가 오지 않은 상황
    await waitFor(() => expect(screen.getByText('a.com')).toBeTruthy());
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('가상 스크롤'), expect.objectContaining({ rowCount: 5 }));
  });

  it('시간순 목록도 같은 보정이 동작한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setSize(0, 0);
    render(<TrafficList exchanges={[ex('1', 'a.com')]} selectedId={undefined} onSelect={() => {}} />);
    expect(screen.queryByText('/p1')).toBeNull();
    setSize(400, 600);
    await waitFor(() => expect(screen.getByText('/p1')).toBeTruthy());
  });

  it('정상적으로 그려지면 보정하지 않는다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setSize(400, 600);
    render(<TrafficGroupList exchanges={[ex('1', 'a.com')]} selectedId={undefined} onSelect={() => {}} checkedIds={new Set()} onCheckedChange={() => {}} />);
    expect(screen.getByText('a.com')).toBeTruthy();
    expect(warn).not.toHaveBeenCalled();
  });

  it('영역이 계속 0이어도 보정을 제한된 횟수만 시도하고 멈춘다(무한 반복 없음)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setSize(0, 0);
    render(<TrafficGroupList exchanges={[ex('1', 'a.com')]} selectedId={undefined} onSelect={() => {}} checkedIds={new Set()} onCheckedChange={() => {}} />);
    await new Promise((r) => setTimeout(r, 400));
    expect(warn.mock.calls.length).toBeGreaterThan(0);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(5);
  });
});
