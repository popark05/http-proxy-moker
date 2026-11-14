import { beforeEach, describe, expect, it, vi } from 'vitest';

const error = vi.fn();
vi.mock('../../src/renderer/src/lib/toast', () => ({ toast: { error: (...a: unknown[]) => error(...a) } }));

import { registerProjectOpeners, toastNoProject } from '../../src/renderer/src/lib/no-project';

describe('toastNoProject', () => {
  beforeEach(() => {
    error.mockClear();
    registerProjectOpeners(undefined);
  });

  it('등록된 동작이 있으면 만들기/열기 버튼을 붙인다', () => {
    const create = vi.fn();
    const open = vi.fn();
    registerProjectOpeners({ create, open });
    toastNoProject('캡처 저장 실패');
    const [title, options] = error.mock.calls[0];
    expect(title).toBe('캡처 저장 실패');
    options.action.onClick();
    options.cancel.onClick();
    expect(create).toHaveBeenCalled();
    expect(open).toHaveBeenCalled();
    expect(options.action.label).toBe('프로젝트 만들기');
  });

  it('동작이 등록되지 않았으면 버튼 없이 안내만 한다', () => {
    toastNoProject('시나리오 저장 실패');
    expect(error.mock.calls[0][1].action).toBeUndefined();
  });
});
