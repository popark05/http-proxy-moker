import { describe, it, expect, vi } from 'vitest';
import type { CapturedExchange } from '../../src/shared/capture';
import { buildRowMenu, buildSessionMenu, menuTargets } from '../../src/renderer/src/lib/traffic-menu';
import { newSessionName } from '../../src/renderer/src/lib/session-name';

const ex = (id: string, url = 'https://api.example.com/a', clientIp?: string): CapturedExchange => ({
  id,
  startedAt: 1,
  request: {
    method: 'GET',
    url,
    path: new URL(url).pathname,
    headers: [],
    body: { encoding: 'empty', content: '', byteLength: 0 },
    ...(clientIp ? { clientIp } : {})
  }
});

const actions = () => ({
  cloneToMock: vi.fn(),
  saveContracts: vi.fn(),
  exportBruno: vi.fn(),
  patchFilter: vi.fn(),
  copy: vi.fn(),
  setChecked: vi.fn()
});

describe('menuTargets', () => {
  const all = [ex('1'), ex('2'), ex('3')];
  it('체크 안 된 행은 그 행만', () => {
    expect(menuTargets([all[0]], all, new Set(['2', '3'])).map((e) => e.id)).toEqual(['1']);
  });
  it('체크된 행을 우클릭하면 체크된 전체', () => {
    expect(menuTargets([all[1]], all, new Set(['2', '3'])).map((e) => e.id)).toEqual(['2', '3']);
  });
  it('체크가 그 행 하나뿐이면 그 행만', () => {
    expect(menuTargets([all[1]], all, new Set(['2'])).map((e) => e.id)).toEqual(['2']);
  });
});

describe('buildRowMenu', () => {
  it('행이 없으면 메뉴도 없다', () => {
    expect(buildRowMenu([], [], new Set(), actions())).toEqual([]);
  });

  it('항목이 대상을 넘기고, 호스트/기기 필터와 복사를 건다', () => {
    const a = actions();
    const row = [ex('1', 'https://api.example.com/a?x=1', '192.168.0.7')];
    const items = buildRowMenu(row, row, new Set(), a);
    const by = (label: string) => items.find((i) => i.label === label)!;

    by('목으로 복제').onSelect();
    expect(a.cloneToMock).toHaveBeenCalledWith(row);
    by('컬렉션에 추가').onSelect();
    expect(a.saveContracts).toHaveBeenCalledWith(row);
    by('Bruno로 내보내기').onSelect();
    expect(a.exportBruno).toHaveBeenCalledWith(row);
    by('URL 복사').onSelect();
    expect(a.copy).toHaveBeenCalledWith('https://api.example.com/a?x=1', 'URL');
    by('api.example.com만 보기').onSelect();
    expect(a.patchFilter).toHaveBeenCalledWith({ host: 'api.example.com' });
    by('192.168.0.7 기기만 보기').onSelect();
    expect(a.patchFilter).toHaveBeenCalledWith({ client: '192.168.0.7' });
  });

  it('여러 개가 대상이면 개수를 표시하고, 선택 토글은 행 단위다', () => {
    const a = actions();
    const all = [ex('1'), ex('2'), ex('3')];
    const items = buildRowMenu([all[1]], all, new Set(['2', '3']), a);
    expect(items[0].label).toBe('목으로 복제 (2개)');
    items.find((i) => i.label === '선택 해제')!.onSelect();
    expect([...a.setChecked.mock.calls[0][0]]).toEqual(['3']);
  });
});

describe('buildSessionMenu', () => {
  it('트래픽이 없으면 저장/비우기는 비활성, 저장된 세션은 불러오기 항목으로 나온다', () => {
    const load = vi.fn();
    const items = buildSessionMenu(0, ['s1', 's2'], { save: vi.fn(), load, clear: vi.fn() });
    expect(items.map((i) => i.label)).toEqual(['캡처 세션으로 저장', '불러오기: s1', '불러오기: s2', '트래픽 비우기']);
    expect(items[0].disabled).toBe(true);
    expect(items[3].disabled).toBe(true);
    items[2].onSelect();
    expect(load).toHaveBeenCalledWith('s2');
  });
});

describe('newSessionName', () => {
  it('저장 시각으로 이름을 만든다', () => {
    expect(newSessionName(new Date(2026, 9, 31, 13, 4, 5))).toBe('session-20261031-130405');
  });
});
