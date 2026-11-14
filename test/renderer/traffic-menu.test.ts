import { describe, it, expect, vi } from 'vitest';
import type { CapturedExchange } from '../../src/shared/capture';
import { buildRowMenu, buildSourceMenu, menuTargets } from '../../src/renderer/src/lib/traffic-menu';
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
    expect(items.some((i) => i.label.includes('Bruno'))).toBe(false); // 내보내기는 컬렉션에서만
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

describe('buildSourceMenu (보기 대상)', () => {
  const actions = () => ({ save: vi.fn(), load: vi.fn(), backToLive: vi.fn(), clear: vi.fn() });

  it('실시간을 보는 중이면 실시간은 비활성이고 저장된 캡처를 고를 수 있다', () => {
    const a = actions();
    const items = buildSourceMenu({ kind: 'live' }, 3, ['s1', 's2'], a);
    expect(items.map((i) => i.label)).toEqual([
      '실시간 (보는 중)',
      '저장된 캡처 보기: s1',
      '저장된 캡처 보기: s2',
      '실시간 목록 저장',
      '실시간 목록 비우기'
    ]);
    expect(items[0].disabled).toBe(true);
    items[2].onSelect();
    expect(a.load).toHaveBeenCalledWith('s2');
    items[3].onSelect();
    expect(a.save).toHaveBeenCalled();
  });

  it('저장된 캡처를 보는 중이면 그 항목이 비활성이고 실시간으로 돌아갈 수 있다', () => {
    const a = actions();
    const items = buildSourceMenu({ kind: 'saved', name: 's1' }, 3, ['s1', 's2'], a);
    expect(items[0]).toMatchObject({ label: '실시간으로 돌아가기', disabled: false });
    expect(items[1]).toMatchObject({ label: '저장된 캡처 보는 중: s1', disabled: true });
    items[0].onSelect();
    expect(a.backToLive).toHaveBeenCalled();
  });

  it('실시간이 비어 있으면 저장·비우기는 비활성', () => {
    const items = buildSourceMenu({ kind: 'live' }, 0, [], actions());
    expect(items.slice(-2).every((i) => i.disabled)).toBe(true);
  });
});

describe('newSessionName', () => {
  it('저장 시각으로 이름을 만든다', () => {
    expect(newSessionName(new Date(2026, 9, 31, 13, 4, 5))).toBe('session-20261031-130405');
  });
});
