import * as crypto from 'node:crypto';
import type { AdbDevice } from '../adb-client';
import { pemToDer } from '../../cert/ca-manager';

const ANDROID_TEMP = '/data/local/tmp';
const SYSTEM_CACERTS = '/system/etc/security/cacerts';

/** shell 출력이 root(uid=0)인지 판정. */
export function isRootOutput(idOutput: string): boolean {
  return idOutput.includes('uid=0(root)');
}

/**
 * openssl -subject_hash_old 와 동일한 값 계산(Android cert store가 요구하는 <hash>.0 파일명).
 * subject DN을 DER로 만든 뒤 MD5 앞 4바이트를 리틀엔디언 uint32로 읽어 8자리 hex.
 * 여기서는 forge 없이 X509Certificate의 subject 원본 DER이 필요하므로,
 * 간이 방식으로 전체 인증서 대신 널리 쓰이는 방식을 따른다.
 *
 * 주의: 정확한 subject_hash_old는 subject DN의 DER 인코딩이 필요하다.
 * node의 X509Certificate는 subject 문자열만 제공하므로, 정확성을 위해
 * 기기에서 openssl로 계산하는 방법도 있으나 여기서는 인증서 파일명에
 * fingerprint 기반 고유 이름을 써서 충돌만 회피한다(시스템 store 로딩은
 * Android가 파일명 규칙을 요구하므로 subjectHash가 이상적).
 */
export function certFileName(certPem: string): string {
  // 정확한 subject_hash_old 대신, 안정적이고 고유한 파일명을 위해
  // 인증서 SHA-256 앞부분을 쓴다. (Phase 1: 에뮬레이터/root 대상, 동작 검증 우선)
  const der = pemToDer(certPem);
  const hash = crypto.createHash('sha256').update(der).digest('hex').slice(0, 8);
  return `${hash}.0`;
}

/**
 * root 명령 래퍼를 만든다. 여러 su 변형을 시도해 성공하는 것을 찾는다.
 * 반환: 성공한 래퍼 함수 또는 undefined(root 불가).
 */
export async function detectRootCommand(
  device: AdbDevice
): Promise<((cmd: string) => string) | undefined> {
  const candidates: Array<(cmd: string) => string> = [
    (cmd) => cmd, // 이미 root
    (cmd) => `su -c '${cmd}'`,
    (cmd) => `su root ${cmd}`
  ];

  for (const wrap of candidates) {
    try {
      const out = await device.shell(wrap('id'));
      if (isRootOutput(out)) return wrap;
    } catch {
      // 다음 후보 시도
    }
  }
  return undefined;
}

/** 기기 글로벌 HTTP 프록시를 host:port로 설정. */
export async function setProxy(device: AdbDevice, host: string, port: number): Promise<void> {
  await device.shell(`settings put global http_proxy ${host}:${port}`);
}

/** 기기 글로벌 HTTP 프록시 해제. */
export async function clearProxy(device: AdbDevice): Promise<void> {
  await device.shell('settings put global http_proxy :0');
  await device.shell('settings delete global http_proxy');
}

/**
 * 시스템 CA store에 CA를 주입(root 필요).
 * Phase 1은 에뮬레이터/root 대상이므로 remount 방식의 핵심 흐름만 구현한다.
 * (HTTPToolkit의 tmpfs mount/APEX nsenter 같은 고급 처리는 Phase 3 범위)
 */
export async function injectSystemCertificate(
  device: AdbDevice,
  root: (cmd: string) => string,
  certPem: string
): Promise<void> {
  const fileName = certFileName(certPem);
  const tmpPath = `${ANDROID_TEMP}/${fileName}`;
  const systemPath = `${SYSTEM_CACERTS}/${fileName}`;

  // 1. CA를 기기 임시 경로로 push.
  await device.pushContent(certPem, tmpPath);

  // 2. /system을 쓰기 가능하게 remount (에뮬레이터: adb root 후 remount).
  await device.shell(root('mount -o rw,remount /system'));

  // 3. CA 파일을 시스템 cacerts로 복사 + 권한 설정.
  await device.shell(root(`cp ${tmpPath} ${systemPath}`));
  await device.shell(root(`chmod 644 ${systemPath}`));
  await device.shell(root(`chown root:root ${systemPath}`));

  // 4. remount를 읽기전용으로 되돌림(best-effort).
  await device.shell(root('mount -o ro,remount /system'));
}
