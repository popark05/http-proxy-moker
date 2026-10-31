import { describe, expect, it } from 'vitest';
import {
  EMPTY_WORKBENCH,
  activateTab,
  closeTab,
  closeTabsWhere,
  cycleTab,
  moveTab,
  openTab,
  pinTab,
  tabKey
} from '../../src/renderer/src/lib/workbench';
import type { WorkbenchState } from '../../src/renderer/src/lib/workbench';

const ex = (id: string) => ({ kind: 'exchange', id }) as const;
const keys = (s: WorkbenchState): string[] => s.tabs.map((t) => t.key);

describe('workbench 탭 모델', () => {
  it('처음 여는 탭은 미리보기이고 활성화된다', () => {
    const s = openTab(EMPTY_WORKBENCH, ex('a'));
    expect(keys(s)).toEqual(['exchange:a']);
    expect(s.activeKey).toBe('exchange:a');
    expect(s.tabs[0].pinned).toBe(false);
  });

  it('새 미리보기는 기존 미리보기 자리를 대신 쓴다', () => {
    const s = openTab(openTab(EMPTY_WORKBENCH, ex('a')), ex('b'));
    expect(keys(s)).toEqual(['exchange:b']);
  });

  it('고정한 탭은 미리보기에 밀려나지 않고, 새 미리보기는 끝에 붙는다', () => {
    let s = openTab(EMPTY_WORKBENCH, ex('a'), { pin: true });
    s = openTab(s, ex('b'));
    s = openTab(s, ex('c'));
    expect(keys(s)).toEqual(['exchange:a', 'exchange:c']);
  });

  it('이미 열린 대상을 다시 열면 중복 없이 활성화만 한다(pin이면 고정도)', () => {
    let s = openTab(EMPTY_WORKBENCH, { kind: 'mocks' }, { pin: true });
    s = openTab(s, ex('a'));
    s = openTab(s, { kind: 'mocks' });
    expect(keys(s)).toEqual(['mocks', 'exchange:a']);
    expect(s.activeKey).toBe('mocks');
    s = openTab(s, ex('a'), { pin: true });
    expect(s.tabs.find((t) => t.key === 'exchange:a')?.pinned).toBe(true);
  });

  it('pinTab은 미리보기를 고정해 다음 미리보기에 밀리지 않게 한다', () => {
    let s = pinTab(openTab(EMPTY_WORKBENCH, ex('a')), 'exchange:a');
    s = openTab(s, ex('b'));
    expect(keys(s)).toEqual(['exchange:a', 'exchange:b']);
  });

  it('활성 탭을 닫으면 오른쪽 이웃, 없으면 왼쪽 이웃이 활성화된다', () => {
    let s = openTab(openTab(openTab(EMPTY_WORKBENCH, ex('a'), { pin: true }), ex('b'), { pin: true }), ex('c'), { pin: true });
    s = activateTab(s, 'exchange:b');
    s = closeTab(s, 'exchange:b');
    expect(s.activeKey).toBe('exchange:c');
    s = closeTab(s, 'exchange:c');
    expect(s.activeKey).toBe('exchange:a');
    s = closeTab(s, 'exchange:a');
    expect(s).toEqual(EMPTY_WORKBENCH);
  });

  it('비활성 탭을 닫아도 활성 탭은 그대로다', () => {
    let s = openTab(openTab(EMPTY_WORKBENCH, ex('a'), { pin: true }), ex('b'), { pin: true });
    s = closeTab(s, 'exchange:a');
    expect(s.activeKey).toBe('exchange:b');
    expect(closeTab(s, 'nope')).toBe(s);
  });

  it('cycleTab은 양 끝에서 순환한다', () => {
    let s = openTab(openTab(EMPTY_WORKBENCH, ex('a'), { pin: true }), ex('b'), { pin: true });
    s = cycleTab(s, 1);
    expect(s.activeKey).toBe('exchange:a');
    s = cycleTab(s, -1);
    expect(s.activeKey).toBe('exchange:b');
  });

  it('moveTab은 순서만 바꾸고 활성 탭은 유지한다', () => {
    let s = openTab(openTab(openTab(EMPTY_WORKBENCH, ex('a'), { pin: true }), ex('b'), { pin: true }), ex('c'), { pin: true });
    s = moveTab(s, 'exchange:c', 'exchange:a');
    expect(keys(s)).toEqual(['exchange:c', 'exchange:a', 'exchange:b']);
    expect(s.activeKey).toBe('exchange:c');
  });

  it('closeTabsWhere로 요청 탭만 한꺼번에 닫는다', () => {
    let s = openTab(openTab(EMPTY_WORKBENCH, { kind: 'mocks' }, { pin: true }), ex('a'), { pin: true });
    s = closeTabsWhere(s, (t) => t.target.kind === 'exchange');
    expect(keys(s)).toEqual(['mocks']);
    expect(s.activeKey).toBe('mocks');
  });

  it('tabKey는 대상마다 안정적이고 새 시나리오는 이름 있는 시나리오와 겹치지 않는다', () => {
    expect(tabKey(ex('x'))).toBe('exchange:x');
    expect(tabKey({ kind: 'mocks' })).toBe('mocks');
    expect(tabKey({ kind: 'library' })).toBe('library');
    expect(tabKey({ kind: 'contracts' })).toBe('contracts');
    expect(tabKey({ kind: 'scenario', name: '결제 실패' })).toBe('scenario:결제 실패');
    expect(tabKey({ kind: 'scenario', name: null })).toBe('scenario-new');
    expect(tabKey({ kind: 'scenario', name: 'new' })).not.toBe(tabKey({ kind: 'scenario', name: null }));
  });

  it('같은 시나리오를 다시 열면 탭을 늘리지 않고, 다른 시나리오는 별도 탭이 된다', () => {
    let s = openTab(EMPTY_WORKBENCH, { kind: 'scenario', name: 'A' }, { pin: true });
    s = openTab(s, { kind: 'scenario', name: 'B' }, { pin: true });
    s = openTab(s, { kind: 'scenario', name: 'A' }, { pin: true });
    expect(keys(s)).toEqual(['scenario:A', 'scenario:B']);
    expect(s.activeKey).toBe('scenario:A');
  });
});
