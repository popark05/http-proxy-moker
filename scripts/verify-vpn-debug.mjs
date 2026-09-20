/**
 * VPN 캡처 디버그용. verify-vpn.mjs와 동일하나 상세 로깅 추가.
 * - tls-client-error / client-error 이벤트로 TLS/파싱 실패를 노출
 * - raw TCP 연결 카운트
 * 사용: node scripts/verify-vpn-debug.mjs <deviceId>
 */
import { execFileSync } from 'node:child_process';
import { getLocal, generateCACertificate, generateSPKIFingerprint } from 'mockttp';
import * as os from 'node:os';

const deviceId = process.argv[2];
if (!deviceId) {
  console.error('사용법: node scripts/verify-vpn-debug.mjs <deviceId>');
  process.exit(1);
}
const PORT = 8899;
const adb = (args) => execFileSync('adb', ['-s', deviceId, ...args], { encoding: 'utf-8' }).trim();

function reachableIps() {
  const out = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}
const urlSafeB64 = (s) =>
  Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

async function main() {
  const ca = await generateCACertificate({
    subject: { commonName: 'MokerProxy QA CA - TESTING ONLY', organizationName: 'MokerProxy' }
  });
  const spki = await generateSPKIFingerprint(ca.cert);
  console.log('CA SPKI:', spki);

  const server = getLocal({ https: { key: ca.key, cert: ca.cert } });
  await server.start(PORT);

  await server.forGet('http://android.httptoolkit.tech/config').thenJson(200, {
    certificate: ca.cert,
    port: PORT
  });
  await server
    .forGet('http://amiusing.httptoolkit.tech/certificate')
    .thenReply(200, ca.cert, { 'content-type': 'application/x-x509-ca-cert' });
  await server.forUnmatchedRequest().thenPassThrough({ ignoreHostHttpsErrors: true });

  server.on('request', (req) => console.log(`[REQ] ${req.method} ${req.url}`));
  server.on('response', (res) => console.log(`[RES] ${res.statusCode} id=${res.id}`));
  server.on('tls-client-error', (e) =>
    console.log(`[TLS-ERR] ${e.failureCause} sni=${e.tlsMetadata?.sniHostname ?? '?'} remote=${e.remoteIpAddress ?? '?'}`)
  );
  server.on('client-error', (e) =>
    console.log(`[CLIENT-ERR] ${e.errorCode ?? '?'} received=${JSON.stringify(String(e.request?.rawStream ?? '').slice(0, 80))}`)
  );
  server.on('abort', (r) => console.log(`[ABORT] ${r.method} ${r.url}`));

  console.log(`proxy listening on ${PORT}`);

  try {
    adb(['reverse', `tcp:${PORT}`, `tcp:${PORT}`]);
    console.log('adb reverse OK');
  } catch (e) {
    console.log('adb reverse failed:', e.message);
  }

  const params = {
    addresses: ['10.0.2.2', '10.0.3.2', ...reachableIps()],
    port: PORT,
    localTunnelPort: PORT,
    enableSocks: false,
    certFingerprint: spki
  };
  const connectUrl = `https://android.httptoolkit.tech/connect/?data=${urlSafeB64(JSON.stringify(params))}`;
  try {
    adb(['shell', 'am', 'start', '-n', 'tech.httptoolkit.android.v1/tech.httptoolkit.android.main.MainActivity']);
  } catch {}
  const res = adb(['shell', 'am', 'start', '-a', 'tech.httptoolkit.android.ACTIVATE', '-d', connectUrl]);
  console.log('ACTIVATE:', res.split('\n')[0]);
  console.log('=== 기기에서 VPN 허용 후 앱 사용. 로그 관찰 중... ===');
}
main().catch((e) => {
  console.error('실패:', e);
  process.exit(1);
});
