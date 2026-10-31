import { describe, expect, it, vi } from 'vitest';
import { buildCommands, filterCommands } from '../../src/renderer/src/lib/commands';
import type { CommandInput } from '../../src/renderer/src/lib/commands';
import type { CapturedExchange } from '../../src/shared/capture';

const exchange = (id: string, method: string, path: string, host = 'api.example.com'): CapturedExchange =>
  ({ id, request: { method, path, url: `https://${host}${path}`, destination: host } }) as unknown as CapturedExchange;

function input(over: Partial<CommandInput> = {}): CommandInput {
  const fn = () => vi.fn();
  return {
    tabs: [{ key: 'mocks', target: { kind: 'mocks' }, pinned: true }],
    describeTab: () => ({ label: '목 · 시나리오' }),
    exchanges: [exchange('1', 'GET', '/users'), exchange('2', 'POST', '/login')],
    mocks: [{ id: 'm1', label: '', method: 'GET', path: '/users', enabled: false, response: { status: 200, headers: [], body: '' } }],
    scenarios: [{ version: 2, id: 's', name: '결제 실패', picks: [] }],
    activeScenario: '결제 실패',
    library: { version: 2, endpoints: [] },
    contracts: [],
    captureSessions: ['세션1'],
    hasProject: true,
    mode: 'capture',
    proxyRunning: false,
    activeTabKey: 'mocks',
    actions: {
      activateTab: fn(), openSection: fn(), openExchange: fn(), openMocks: fn(), openScenario: fn(), activateScenario: fn(),
      openLibrary: fn(), openContracts: fn(), loadSession: fn(), startProxy: fn(), stopProxy: fn(), setMode: fn(),
      closeActiveTab: fn(), clearCapture: fn()
    },
    ...over
  };
}

const labels = (list: { label: string }[]): string[] => list.map((c) => c.label);

describe('커맨드 팔레트 모델', () => {
  it('프록시와 모드 동작은 현재 상태에 맞는 쪽만 만든다', () => {
    const idle = labels(buildCommands(input()));
    expect(idle).toContain('프록시 시작');
    expect(idle).not.toContain('프록시 중지');
    expect(idle).toContain('목킹 모드로 전환');
    const running = labels(buildCommands(input({ proxyRunning: true, mode: 'mock' })));
    expect(running).toContain('프록시 중지');
    expect(running).toContain('캡처 모드로 전환');
  });

  it('새 시나리오는 라이브러리에 케이스가 있을 때만, 세션은 프로젝트가 있을 때만 만든다', () => {
    const none = labels(buildCommands(input({ hasProject: false })));
    expect(none).not.toContain('새 시나리오 만들기');
    expect(none).not.toContain('세션 불러오기: 세션1');
    const some = labels(
      buildCommands(input({ library: { version: 2, endpoints: [{ id: 'GET /x', method: 'GET', path: '/x', cases: [] }] } }))
    );
    expect(some).toContain('새 시나리오 만들기');
  });

  it('검색어가 없으면 요청 목록은 숨긴다', () => {
    const all = buildCommands(input());
    expect(filterCommands(all, '').some((c) => c.group === '요청')).toBe(false);
    expect(filterCommands(all, '   ').some((c) => c.group === '요청')).toBe(false);
  });

  it('모든 단어가 들어 있어야 하고 대소문자는 구분하지 않는다', () => {
    const all = buildCommands(input());
    expect(labels(filterCommands(all, 'post login'))).toEqual(['POST /login']);
    expect(labels(filterCommands(all, 'get users')).filter((l) => l === 'GET /users')).toHaveLength(2); // 목 + 요청
    expect(filterCommands(all, 'post users')).toHaveLength(0);
  });

  it('앞부분 일치가 단어 중간 일치보다 위에 온다', () => {
    const all = buildCommands(input());
    const result = labels(filterCommands(all, '시나리오'));
    // "시나리오 활성화/편집"(앞부분)이 "목 · 시나리오 열기"(중간)보다 먼저
    expect(result.indexOf('시나리오 활성화: 결제 실패')).toBeLessThan(result.indexOf('목 · 시나리오 열기'));
  });

  it('라벨에 없는 키워드(호스트, 영문 별칭)로도 찾는다', () => {
    const all = buildCommands(input());
    expect(labels(filterCommands(all, 'example')).some((l) => l.includes('/users'))).toBe(true);
    expect(labels(filterCommands(all, 'proxy start'))).toContain('프록시 시작');
  });

  it('항목을 실행하면 해당 동작이 불린다', () => {
    const i = input();
    const all = buildCommands(i);
    filterCommands(all, '캡처 지우기')[0].run();
    expect(i.actions.clearCapture).toHaveBeenCalled();
    filterCommands(all, 'post login')[0].run();
    expect(i.actions.openExchange).toHaveBeenCalledWith('2');
  });

  it('결과는 50개로 제한한다', () => {
    const many = Array.from({ length: 200 }, (_, n) => exchange(`e${n}`, 'GET', `/p${n}`));
    expect(filterCommands(buildCommands(input({ exchanges: many })), 'p')).toHaveLength(50);
  });
});
