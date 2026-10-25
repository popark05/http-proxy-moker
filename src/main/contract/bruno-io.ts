import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { brunoFileName, brunoToContract, exportBrunoCollection } from '@shared/bruno';
import type { Contract, ContractServer } from '@shared/contract';

/** 부모 폴더 아래에 컬렉션 폴더를 만들어 계약을 내보낸다. 이미 있는 폴더는 건드리지 않고 이름 뒤에 번호를 붙인다. */
export async function writeBrunoCollection(
  parentDir: string,
  name: string,
  contracts: Contract[],
  servers: ContractServer[]
): Promise<{ dir: string; files: number }> {
  const base = brunoFileName(name);
  let dir = path.join(parentDir, base);
  for (let n = 2; await exists(dir); n++) dir = path.join(parentDir, `${base} (${n})`);
  const files = exportBrunoCollection(name, contracts, servers);
  for (const file of files) {
    const target = path.join(dir, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, 'utf-8');
  }
  return { dir, files: files.length };
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
