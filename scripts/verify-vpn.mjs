/**
 * 실기기 VPN 방식 수동 검증 스크립트.
 *
 * 우리 앱의 핵심 흐름을 헤드리스로 재현한다:
 *  1. CA 생성/로드 + mockttp 프록시 시작(companion 검증 엔드포인트 포함)
 *  2. adb reverse 터널 + 기기 프록시 접근 경로 확인
 *  3. companion 앱에 ACTIVATE 인텐트 전송(우리 CA 지문 포함)
 *
 * 사용: node scripts/verify-vpn.mjs <deviceId>
 * 종료: Ctrl+C (프록시 정리)
 *
 * 실행 후 기기 화면에서 VPN 연결 요청을 "허용"해야 트래픽 캡처가 시작된다.
 */
import { execFileSync, execFile } from 'node:child_process';
import { getLocal, generateCACertificate, generateSPKIFingerprint } from 'mockttp';
import * as os from 'node:os';

const deviceId = process.argv[2];
if (!deviceId) {
  console.error('사용법: node scripts/verify-vpn.mjs <deviceId>');
  process.exit(1);
}

const PORT = 8899;

function adb(args) {
  return execFileSync('adb', ['-s', deviceId, ...args], { encoding: 'utf-8' }).trim();
}

function reachableIps() {
  const out = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

function urlSafeBase64(s) {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

async function main() {
  console.log('1) CA 생성 + 프록시 시작...');
  const ca = await generateCACertificate({
    subject: { commonName: 'MokerProxy QA CA - TESTING ONLY', organizationName: 'MokerProxy' }
  });
  const spki = await generateSPKIFingerprint(ca.cert);
  console.log('   CA SPKI 지문:', spki);

  const server = getLocal({ https: { key: ca.key, cert: ca.cert } });
  await server.start(PORT);

  // companion 검증 엔드포인트
  await server.forGet('http://android.httptoolkit.tech/config').thenJson(200, {
    certificate: ca.cert,
    port: PORT
  });
  await server
    .forGet('http://amiusing.httptoolkit.tech/certificate')
    .thenReply(200, ca.cert, { 'content-type': 'application/x-x509-ca-cert' });
  // 나머지는 통과(캡처 로그)
  await server.forUnmatchedRequest().thenPassThrough({ ignoreHostHttpsErrors: true });

  server.on('request', (req) => console.log(`   [캡처] ${req.method} ${req.url}`));

  console.log(`   프록시 실행 중: 포트 ${PORT}`);

  console.log('2) adb reverse 터널 설정...');
  try {
    adb(['reverse', `tcp:${PORT}`, `tcp:${PORT}`]);
    console.log('   reverse OK (기기 localhost:%d → 호스트 프록시)', PORT);
  } catch (e) {
    console.log('   reverse 실패(계속): ', e.message);
  }

  console.log('3) companion 앱에 ACTIVATE 인텐트 전송...');
  const params = {
    addresses: ['10.0.2.2', '10.0.3.2', ...reachableIps()],
    port: PORT,
    localTunnelPort: PORT,
    enableSocks: false,
    certFingerprint: spki
  };
  const data = urlSafeBase64(JSON.stringify(params));
  const connectUrl = `https://android.httptoolkit.tech/connect/?data=${data}`;

  // 앱 포그라운드
  try {
    adb([
      'shell',
      'am',
      'start',
      '-n',
      'tech.httptoolkit.android.v1/tech.httptoolkit.android.main.MainActivity'
    ]);
  } catch (e) {
    console.log('   bringToFront 실패(계속):', e.message);
  }

  // ACTIVATE 인텐트
  const result = adb([
    'shell',
    'am',
    'start',
    '-a',
    'tech.httptoolkit.android.ACTIVATE',
    '-d',
    connectUrl
  ]);
  console.log('   인텐트 결과:', result.split('\n')[0]);

  console.log('');
  console.log('=== 이제 기기 화면에서 "VPN 연결 요청"을 허용하세요 ===');
  console.log('허용 후, 기기에서 앱을 사용하면 아래에 [캡처] 로그가 찍힙니다.');
  console.log('종료하려면 Ctrl+C. (프록시가 정리됩니다)');

  const cleanup = async () => {
    console.log('\n정리 중...');
    try {
      adb([
        'shell',
        'am',
        'start',
        '-a',
        'tech.httptoolkit.android.DEACTIVATE'
      ]);
    } catch {
      // 무시
    }
    await server.stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((e) => {
  console.error('검증 실패:', e);
  process.exit(1);
});
