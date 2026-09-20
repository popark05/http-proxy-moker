// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProjectStore } from '../../src/main/project/project-store';
import type { CapturedExchange } from '../../src/shared/capture';

let dir: string | undefined;

afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  dir = undefined;
});

function sampleExchanges(): CapturedExchange[] {
  return [
    {
      id: 'e1',
      startedAt: 1000,
      request: {
        method: 'GET',
        url: 'http://x.com/a',
        path: '/a',
        headers: [['host', 'x.com']],
        body: { encoding: 'empty', content: '', byteLength: 0 }
      },
      response: {
        statusCode: 200,
        statusMessage: 'OK',
        headers: [['content-type', 'text/plain']],
        body: { encoding: 'text', content: 'hi', byteLength: 2, contentType: 'text/plain' }
      }
    }
  ];
}

describe('ProjectStore', () => {
  it('프로젝트를 생성하면 project.json과 하위 디렉토리가 만들어진다', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-proj-'));
    const store = new ProjectStore();
    const project = await store.create(dir, 'My QA');

    expect(project.meta.name).toBe('My QA');
    expect(project.meta.version).toBe(1);
    await fs.access(path.join(dir, 'project.json'));
    await fs.access(path.join(dir, 'captures'));
    await fs.access(path.join(dir, 'scenarios'));
  });

  it('캡처 세션을 저장하고 다시 로드하면 exchange가 복원된다', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-proj-'));
    const store = new ProjectStore();
    await store.create(dir, 'P');

    const saved = await store.saveCaptureSession(dir, 'session-1', sampleExchanges());
    expect(saved).toBe('session-1');

    const loaded = await store.loadCaptureSession(dir, 'session-1');
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('e1');
    expect(loaded[0].request.url).toBe('http://x.com/a');
    if (loaded[0].response && loaded[0].response !== 'aborted') {
      expect(loaded[0].response.body.content).toBe('hi');
    }
  });

  it('캡처 세션의 태그를 저장·로드 후 보존한다', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-proj-'));
    const store = new ProjectStore();
    await store.create(dir, 'P');

    const tagged = sampleExchanges();
    tagged[0].tags = ['smoke', 'auth'];

    await store.saveCaptureSession(dir, 'tagged', tagged);
    const loaded = await store.loadCaptureSession(dir, 'tagged');
    expect(loaded[0].tags).toEqual(['smoke', 'auth']);
  });

  it('open은 저장된 세션 목록을 반영한다', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-proj-'));
    const store = new ProjectStore();
    await store.create(dir, 'P');
    await store.saveCaptureSession(dir, 'alpha', sampleExchanges());
    await store.saveCaptureSession(dir, 'beta', sampleExchanges());

    const reopened = await store.open(dir);
    expect(reopened.captureSessions).toEqual(['alpha', 'beta']);
  });

  it('위험한 세션 이름은 살균된다', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-proj-'));
    const store = new ProjectStore();
    await store.create(dir, 'P');
    const saved = await store.saveCaptureSession(dir, '../../etc/passwd', sampleExchanges());
    expect(saved).not.toContain('/');
    expect(saved).not.toContain('..');
  });

  it('목 시나리오를 저장하고 로드하면 목 정의가 복원된다', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-proj-'));
    const store = new ProjectStore();
    await store.create(dir, 'P');

    const scenario = {
      version: 1 as const,
      id: 's1',
      name: 'error-cases',
      description: '에러 시나리오',
      mocks: [
        {
          id: 'm1',
          label: 'GET /users',
          method: 'GET',
          path: '/users',
          response: { status: 500, headers: [] as Array<[string, string]>, body: '{"error":1}' },
          enabled: true
        }
      ]
    };

    const saved = await store.saveScenario(dir, scenario);
    expect(saved).toBe('error-cases');

    const loaded = await store.loadScenario(dir, 'error-cases');
    expect(loaded.name).toBe('error-cases');
    expect(loaded.mocks).toHaveLength(1);
    expect(loaded.mocks[0].response.status).toBe(500);

    // open이 시나리오 목록을 반영.
    const reopened = await store.open(dir);
    expect(reopened.scenarios).toContain('error-cases');
  });

  it('지연/fault가 포함된 시나리오를 손실 없이 저장·로드한다', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-proj-'));
    const store = new ProjectStore();
    await store.create(dir, 'P');

    const scenario = {
      version: 1 as const,
      id: 's2',
      name: 'edge',
      mocks: [
        {
          id: 'm1',
          label: 'slow',
          method: 'GET',
          path: '/slow',
          response: { status: 200, headers: [] as Array<[string, string]>, body: 'ok' },
          enabled: true,
          delayMs: 800,
          fault: 'none' as const
        },
        {
          id: 'm2',
          label: 'reset',
          method: 'POST',
          path: '/boom',
          response: { status: 200, headers: [] as Array<[string, string]>, body: '' },
          enabled: true,
          fault: 'reset' as const
        }
      ]
    };

    await store.saveScenario(dir, scenario);
    const loaded = await store.loadScenario(dir, 'edge');
    expect(loaded.mocks[0].delayMs).toBe(800);
    expect(loaded.mocks[1].fault).toBe('reset');
  });

  it('시나리오를 삭제하면 open 목록에서 사라진다', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-proj-'));
    const store = new ProjectStore();
    await store.create(dir, 'P');
    await store.saveScenario(dir, {
      version: 1,
      id: 's3',
      name: 'temp',
      mocks: []
    });

    expect((await store.open(dir)).scenarios).toContain('temp');
    await store.deleteScenario(dir, 'temp');
    expect((await store.open(dir)).scenarios).not.toContain('temp');
  });
});
