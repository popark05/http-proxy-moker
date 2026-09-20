import * as crypto from 'node:crypto';
import { pemToDer } from './ca-manager';

/** XML plist 문자열 이스케이프. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** UUID를 생성(설정 프로파일 식별자). */
function uuid(): string {
  return crypto.randomUUID().toUpperCase();
}

export interface MobileConfigOptions {
  certPem: string;
  /** 프로파일 표시 이름. */
  displayName?: string;
  /** 프로파일 식별자(역DNS). */
  identifier?: string;
}

/**
 * iOS/macOS용 CA 신뢰 설정 프로파일(.mobileconfig)을 생성한다.
 * CA 인증서를 DER→base64로 PayloadContent에 담아 사용자가 기기에 설치하도록 한다.
 * 설치 후 iOS는 설정 > 일반 > 정보 > 인증서 신뢰에서 수동 신뢰 활성화가 추가로 필요.
 */
export function generateMobileConfig(options: MobileConfigOptions): string {
  const displayName = options.displayName ?? 'MokerProxy QA CA';
  const identifier = options.identifier ?? 'com.mokerproxy.qa.ca';
  const certBase64 = pemToDer(options.certPem).toString('base64');

  const certUuid = uuid();
  const profileUuid = uuid();

  // base64를 64자마다 줄바꿈(plist data 관례).
  const wrapped = (certBase64.match(/.{1,64}/g) ?? []).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>PayloadContent</key>
	<array>
		<dict>
			<key>PayloadCertificateFileName</key>
			<string>${escapeXml(displayName)}.cer</string>
			<key>PayloadContent</key>
			<data>
${wrapped}
			</data>
			<key>PayloadDescription</key>
			<string>MokerProxy가 HTTPS 트래픽을 복호화하기 위한 루트 CA 인증서입니다.</string>
			<key>PayloadDisplayName</key>
			<string>${escapeXml(displayName)}</string>
			<key>PayloadIdentifier</key>
			<string>${escapeXml(identifier)}.cert</string>
			<key>PayloadType</key>
			<string>com.apple.security.root</string>
			<key>PayloadUUID</key>
			<string>${certUuid}</string>
			<key>PayloadVersion</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>PayloadDescription</key>
	<string>MokerProxy QA용 CA 신뢰 프로파일. 내부 테스트 전용.</string>
	<key>PayloadDisplayName</key>
	<string>${escapeXml(displayName)}</string>
	<key>PayloadIdentifier</key>
	<string>${escapeXml(identifier)}</string>
	<key>PayloadRemovalDisallowed</key>
	<false/>
	<key>PayloadType</key>
	<string>Configuration</string>
	<key>PayloadUUID</key>
	<string>${profileUuid}</string>
	<key>PayloadVersion</key>
	<integer>1</integer>
</dict>
</plist>
`;
}
