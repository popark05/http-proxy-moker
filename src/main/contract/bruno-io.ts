import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { brunoFileName, brunoToContract, exportBrunoCollection } from '@shared/bruno';
import { sameRequest, type Contract, type ContractServer } from '@shared/contract';

export interface BrunoWriteResult {
  dir: string;
  /** 새로 쓴 파일 수(요청 + 환경 + bruno.json). */
  files: number;
  /** 기존 컬렉션에 추가했는가(true) / 새 컬렉션을 만들었는가(false). */
  merged: boolean;
  /** 추가한 요청 수. */
  added: number;
  /** 기존 컬렉션에 이미 같은 요청이 있어 건너뛴 수. */
  existing: number;
}

/**
 * 선택한 폴더가 이미 Bruno 컬렉션(bruno.json)이면 거기에 요청을 추가하고(같은 요청·기존 환경은 건드리지 않음),
 * 아니면 그 아래에 컬렉션 폴더를 새로 만든다(같은 이름이 있으면 번호를 붙인다). 다시 내보내도 안전하다.
 */
export async function writeBrunoCollection(
  chosenDir: string,
  name: string,
  contracts: Contract[],
  servers: ContractServer[]
): Promise<BrunoWriteResult> {
  const merged = await exists(path.join(chosenDir, 'bruno.json'));
  let dir = chosenDir;
  let todo = contracts;
  let existingCount = 0;
  if (!merged) {
    const base = brunoFileName(name);
    dir = path.join(chosenDir, base);
    for (let n = 2; await exists(dir); n++) dir = path.join(chosenDir, `${base} (${n})`);
  } else {
    const have = (await readBrunoCollection(chosenDir, () => 'existing')).contracts;
    todo = contracts.filter((c) => !have.some((h) => sameRequest(h, c)));
    existingCount = contracts.length - todo.length;
  }

  let written = 0;
  for (const file of exportBrunoCollection(name, todo, servers)) {
    if (merged && file.path === 'bruno.json') continue;
    let target = path.join(dir, file.path);
    if (merged && file.path.startsWith('environments/') && (await exists(target))) continue;
    // 요청 파일 이름이 겹치면(다른 요청이 같은 파일명) 번호를 붙인다.
    for (let n = 2; file.path.endsWith('.bru') && !file.path.startsWith('environments/') && (await exists(target)); n++) {
      target = path.join(dir, file.path.replace(/\.bru$/, ` (${n}).bru`));
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, 'utf-8');
    written++;
  }
  return { dir, files: written, merged, added: todo.length, existing: existingCount };
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function listBru(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await listBru(full, out);
    else if (entry.name.endsWith('.bru')) out.push(full);
  }
  return out;
}

export interface BrunoImport {
  contracts: Contract[];
  /** 파일별로 건너뛴 부분 설명(`파일명: 사유`). */
  notes: string[];
  /** 요청이 아니라서 건너뛴 파일 수(환경, collection.bru 등). */
  skippedFiles: number;
}

/** 폴더 안의 요청 .bru를 모두 계약으로 읽는다(하위 폴더 포함). */
export async function readBrunoCollection(dir: string, newId: () => string): Promise<BrunoImport> {
  const result: BrunoImport = { contracts: [], notes: [], skippedFiles: 0 };
  for (const file of (await listBru(dir)).sort()) {
    const rel = path.relative(dir, file);
    if (rel.split(path.sep)[0] === 'environments' || path.basename(file) === 'collection.bru' || path.basename(file) === 'folder.bru') {
      result.skippedFiles++;
      continue;
    }
    const { contract, notes } = brunoToContract(await fs.readFile(file, 'utf-8'), path.basename(file, '.bru'), newId());
    if (!contract) {
      result.skippedFiles++;
      result.notes.push(...notes.map((n) => `${rel}: ${n}`));
      continue;
    }
    result.contracts.push(contract);
    result.notes.push(...notes.map((n) => `${rel}: ${n}`));
  }
  return result;
}
