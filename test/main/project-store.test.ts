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

  it('한글 이름은 보존하고 Windows 예약어/끝의 점은 안전하게 바꾼다', async () => {
    const store = new ProjectStore();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-name-'));
    await store.create(dir, 'p');
    expect(await store.saveCaptureSession(dir, '로그인 시나리오', [])).toBe('로그인_시나리오');
    expect(await store.saveCaptureSession(dir, 'CON', [])).toBe('_CON');
    expect(await store.saveCaptureSession(dir, 'nul.txt', [])).toBe('_nul.txt');
    expect(await store.saveCaptureSession(dir, 'abc. ', [])).toBe('abc');
    await fs.rm(dir, { recursive: true, force: true });
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

describe('ProjectStore: 케이스 라이브러리/시나리오 v2', () => {
  it('라이브러리가 없으면 빈 라이브러리, 저장 후 다시 읽으면 복원', async () => {
    const store = new ProjectStore();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-lib-'));
    await store.create(dir, 'p');
    expect((await store.loadLibrary(dir)).endpoints).toEqual([]);
    const lib = { version: 2 as const, endpoints: [{ id: 'GET /a', method: 'GET', path: '/a', cases: [] }] };
    await store.saveLibrary(dir, lib);
    expect(await store.loadLibrary(dir)).toEqual(lib);
  });

  it('깨진 library.json은 빈 라이브러리로 처리', async () => {
    const store = new ProjectStore();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-lib-'));
    await store.create(dir, 'p');
    await fs.writeFile(path.join(dir, 'library.json'), '{not json', 'utf-8');
    expect((await store.loadLibrary(dir)).endpoints).toEqual([]);
  });

  it('시나리오 이름은 파일명으로 맞춰지고(상속 참조 일관성), loadAll이 모두 읽는다', async () => {
    const store = new ProjectStore();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-lib-'));
    await store.create(dir, 'p');
    const saved = await store.saveScenario(dir, { version: 2, id: 's1', name: '결제 실패!', picks: [] });
    expect(saved).toBe('결제_실패_');
    const all = await store.loadAllScenarios(dir);
    expect(all.map((s) => s.name)).toEqual(['결제_실패_']);
    expect((await store.loadScenario(dir, saved)).name).toBe('결제_실패_');
  });

  it('v1 시나리오를 v2로 덮어쓰면 원본을 .v1.bak으로 보관하고 목록에는 나타나지 않는다', async () => {
    const store = new ProjectStore();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-lib-'));
    await store.create(dir, 'p');
    await store.saveScenario(dir, { version: 1, id: 'a', name: 'old', mocks: [] });
    await store.saveScenario(dir, { version: 2, id: 'a', name: 'old', picks: [] });
    const backup = JSON.parse(await fs.readFile(path.join(dir, 'scenarios', 'old.v1.bak'), 'utf-8'));
    expect(backup.version).toBe(1);
    expect((await store.open(dir)).scenarios).toEqual(['old']);
    // 같은 v2를 다시 저장해도 백업은 덮어쓰이지 않는다(v2가 v1 백업을 망가뜨리지 않음).
    await store.saveScenario(dir, { version: 2, id: 'a', name: 'old', picks: [] });
    expect(JSON.parse(await fs.readFile(path.join(dir, 'scenarios', 'old.v1.bak'), 'utf-8')).version).toBe(1);
  });
});
