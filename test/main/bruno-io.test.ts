// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readBrunoCollection, writeBrunoCollection } from '../../src/main/contract/bruno-io';
import { inferShape, type Contract } from '../../src/shared/contract';

let dir: string | undefined;
afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  dir = undefined;
});

const contract = (name: string, p: string): Contract => ({
  version: 1,
  id: name,
  endpointId: `GET ${p}`,
  name,
  source: { capturedAt: 1, origin: 'https://api.example.com' },
  request: { method: 'GET', urlTemplate: `{{baseUrl}}${p}`, query: [], headers: [['Authorization', '{{authorization}}']] },
  expect: { status: 200, headers: [], bodyShape: inferShape({ id: 1 }) },
  verifiable: true,
  safeToRun: true
});

describe('Bruno 폴더 입출력', () => {
  it('내보낸 폴더를 다시 읽으면 같은 계약이 나오고, 같은 이름 폴더는 덮어쓰지 않는다', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-bruno-'));
    const a = await writeBrunoCollection(dir, 'QA', [contract('GET /a', '/a'), contract('GET /b', '/b')], [{ name: 'dev', baseUrl: 'https://dev.example.com' }]);
    const b = await writeBrunoCollection(dir, 'QA', [contract('GET /a', '/a')], []);
    expect(path.basename(a.dir)).toBe('QA');
    expect(path.basename(b.dir)).toBe('QA (2)');

    let n = 0;
    const read = await readBrunoCollection(a.dir, () => `id${n++}`);
    expect(read.contracts.map((c) => c.endpointId)).toEqual(['GET /a', 'GET /b']);
    expect(read.contracts[0].expect).toEqual(contract('x', '/a').expect);
    expect(read.skippedFiles).toBe(2); // 환경 파일 2개(dev, captured-…). bruno.json은 .bru가 아니라 세지 않는다
    expect(read.notes).toEqual([]);
  });
});

describe('기존 컬렉션에 추가', () => {
  it('같은 요청은 건너뛰고 새 요청만 추가하며 기존 파일과 환경은 건드리지 않는다', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moker-bruno-merge-'));
    const first = await writeBrunoCollection(dir, 'QA', [contract('GET /a', '/a')], []);
    expect(first).toMatchObject({ merged: false, added: 1, existing: 0 });
    const envDir = path.join(first.dir, 'environments');
    const envBefore = await fs.readdir(envDir);
    await fs.writeFile(path.join(envDir, envBefore[0]), 'vars {\n  baseUrl: https://edited\n}\n');

    const second = await writeBrunoCollection(first.dir, 'QA', [contract('GET /a', '/a'), contract('GET /b', '/b')], []);
    expect(second).toMatchObject({ dir: first.dir, merged: true, added: 1, existing: 1 });
    let n = 0;
    const all = await readBrunoCollection(first.dir, () => `i${n++}`);
    expect(all.contracts.map((c) => c.endpointId).sort()).toEqual(['GET /a', 'GET /b']);
    expect(await fs.readFile(path.join(envDir, envBefore[0]), 'utf-8')).toContain('https://edited');
    expect(await fs.readdir(dir)).toEqual(['QA']); // 새 폴더를 또 만들지 않았다
  });
});
