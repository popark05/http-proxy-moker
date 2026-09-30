/**
 * APK 설치/제거. dadb Dadb.install/installMultiple/uninstall 이식(Apache-2.0, NOTICE 참고).
 *
 * - `cmd` 지원(Android 7+): `exec:cmd package install -S <size>`로 APK 바이트를 스트리밍한다(임시 파일 없음).
 * - 미지원: /data/local/tmp로 push 후 `pm install`, 끝나면 임시 파일을 지운다(dadb는 남겨 둠).
 * 설치 거부는 InstallResult 실패로 돌려준다(응답이 "Success"로 시작하는지로 판정 — adb와 동일).
 */

import { createReadStream, promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { AdbStreamLike } from '../protocol/session';
import { StreamReader, StreamWriter } from '../protocol/stream-io';
import { SUCCESS, failure, type InstallResult, type UninstallResult } from '../results';
import { execCmd, type AdbOpener } from './opener';
import { shell } from './shell';
import { push, type ByteSource } from './sync';

const REMOTE_TMP = '/data/local/tmp';

/** 로컬 APK 파일 또는 바이트를 설치한다. options 예: ['-r', '-g']. */
export async function install(
  adb: AdbOpener,
  apk: string | Uint8Array,
  ...options: string[]
): Promise<InstallResult> {
  if (typeof apk === 'string') {
    const { size } = await fs.stat(apk);
    return installStream(adb, createReadStream(apk), size, ...options);
  }
  return installStream(adb, apk, apk.length, ...options);
}

/** 크기를 아는 바이트 스트림을 설치한다. */
export async function installStream(
  adb: AdbOpener,
  source: ByteSource,
  size: number,
  ...options: string[]
): Promise<InstallResult> {
  if (await adb.supportsFeature('cmd')) {
    const stream = await execCmd(adb, 'package', 'install', '-S', String(size), ...options);
    const response = await writeThenReadResponse(stream, source);
    return response.startsWith('Success') ? SUCCESS : failure(response);
  }
  return pmInstall(adb, source, `${REMOTE_TMP}/dadb-${randomName()}.apk`, options);
}

/** split APK들을 하나의 설치 세션으로 설치한다. */
export async function installMultiple(
  adb: AdbOpener,
  apks: string[],
  ...options: string[]
): Promise<InstallResult> {
  const sizes = await Promise.all(apks.map(async (apk) => (await fs.stat(apk)).size));
  const totalSize = sizes.reduce((a, b) => a + b, 0);

  if (await adb.supportsFeature('cmd')) {
    const create = await readAllText(
      await execCmd(adb, 'package', 'install-create', '-S', String(totalSize), ...options)
    );
    if (!create.startsWith('Success')) return failure(`설치 세션 생성 실패: ${create}`);
    const sessionId = parseSessionId(create);
    if (!sessionId) return failure(`세션 ID 파싱 실패: ${create}`);

    let error: string | undefined;
    for (let i = 0; i < apks.length && !error; i++) {
      const stream = await execCmd(
        adb,
        'package',
        'install-write',
        '-S',
        String(sizes[i]),
        sessionId,
        path.basename(apks[i]),
        '-',
        ...options
      );
      const response = await writeThenReadResponse(stream, createReadStream(apks[i]));
      if (!response.startsWith('Success')) error = response;
    }

    const finalCommand = error === undefined ? 'install-commit' : 'install-abandon';
    const final = await readAllText(await execCmd(adb, 'package', finalCommand, sessionId, ...options));
    if (!final.startsWith('Success')) return failure(`설치 세션 마무리 실패: ${final}`);
    return error === undefined ? SUCCESS : failure(error);
  }

  const create = await shell(adb, `pm install-create -S ${totalSize} ${options.join(' ')}`);
  if (!create.allOutput.startsWith('Success')) return failure(`pm 설치 세션 생성 실패: ${create.allOutput}`);
  const sessionId = parseSessionId(create.allOutput);
  if (!sessionId) return failure(`세션 ID 파싱 실패: ${create.allOutput}`);

  let error: string | undefined;
  const remotePaths: string[] = [];
  for (let i = 0; i < apks.length && !error; i++) {
    const remotePath = `${REMOTE_TMP}/${path.basename(apks[i])}`;
    remotePaths.push(remotePath);
    const pushed = await push(adb, apks[i], remotePath);
    if (!pushed.success) {
      error = `push 실패: ${pushed.reason}`;
      break;
    }
    const written = await shell(adb, `pm install-write -S ${sizes[i]} ${sessionId} ${i} ${remotePath}`);
    if (!written.allOutput.startsWith('Success')) error = written.allOutput;
  }

  const final = await shell(
    adb,
    error === undefined ? `pm install-commit ${sessionId}` : `pm install-abandon ${sessionId}`
  );
  await removeRemote(adb, remotePaths);
  if (!final.allOutput.startsWith('Success')) return failure(`설치 세션 마무리 실패: ${final.allOutput}`);
  return error === undefined ? SUCCESS : failure(error);
}

/** 패키지 제거. 0이 아닌 종료 코드는 실패 결과(출력과 종료 코드 포함). */
export async function uninstall(adb: AdbOpener, packageName: string): Promise<UninstallResult> {
  const command = (await adb.supportsFeature('cmd')) ? 'cmd package uninstall' : 'pm uninstall';
  const response = await shell(adb, `${command} ${packageName}`);
  return response.exitCode === 0
    ? SUCCESS
    : { success: false, reason: response.allOutput, exitCode: response.exitCode };
}

async function pmInstall(
  adb: AdbOpener,
  source: ByteSource,
  remotePath: string,
  options: string[]
): Promise<InstallResult> {
  const pushed = await push(adb, source, remotePath);
  if (!pushed.success) return failure(`push 실패: ${pushed.reason}`);
  try {
    const response = await shell(adb, `pm install ${options.join(' ')} "${remotePath}"`);
    return response.allOutput.startsWith('Success') ? SUCCESS : failure(response.allOutput);
  } finally {
    await removeRemote(adb, [remotePath]);
  }
}

/**
 * 바이트를 모두 쓰고 응답을 읽는다. pm이 APK를 끝까지 읽기 전에 거부하고 스트림을 닫으면
 * 쓰기가 실패하지만, 그 전에 온 응답("Failure [...]")은 읽을 수 있으므로 응답을 우선한다.
 */
async function writeThenReadResponse(stream: AdbStreamLike, source: ByteSource): Promise<string> {
  const writer = new StreamWriter(stream);
  let writeError: unknown;
  try {
    const iterable: AsyncIterable<Uint8Array> | Iterable<Uint8Array> =
      source instanceof Uint8Array ? [source] : source;
    for await (const chunk of iterable) await writer.write(chunk);
    await writer.flush();
  } catch (e) {
    writeError = e;
  }
  try {
    const response = (await new StreamReader(stream).readToEnd()).toString('utf-8');
    if (writeError !== undefined && response.length === 0) throw writeError;
    return response;
  } catch (e) {
    throw writeError ?? e;
  } finally {
    await stream.close();
  }
}

async function readAllText(stream: AdbStreamLike): Promise<string> {
  try {
    return (await new StreamReader(stream).readToEnd()).toString('utf-8');
  } finally {
    await stream.close();
  }
}

/** "Success: created install session [1234]" → "1234" */
function parseSessionId(response: string): string | undefined {
  return /\[(\w+)]/.exec(response)?.[1];
}

async function removeRemote(adb: AdbOpener, remotePaths: string[]): Promise<void> {
  if (remotePaths.length === 0) return;
  try {
    await shell(adb, `rm -f ${remotePaths.map((p) => `"${p}"`).join(' ')}`);
  } catch {
    // 임시 파일 정리는 best-effort.
  }
}

function randomName(): string {
  return crypto.randomBytes(6).toString('hex');
}
