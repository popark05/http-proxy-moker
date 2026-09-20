// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { generateMobileConfig } from '../../src/main/cert/mobileconfig';

const SAMPLE_CERT = `-----BEGIN CERTIFICATE-----\n${Buffer.from(
  'sample-der-bytes'
).toString('base64')}\n-----END CERTIFICATE-----`;

describe('generateMobileConfig', () => {
  it('유효한 plist 구조를 생성한다', () => {
    const config = generateMobileConfig({ certPem: SAMPLE_CERT });
    expect(config).toContain('<?xml version="1.0"');
    expect(config).toContain('<plist version="1.0">');
    expect(config).toContain('com.apple.security.root');
    expect(config).toContain('PayloadType');
    expect(config).toContain('Configuration');
  });

  it('CA를 base64 data로 포함한다', () => {
    const config = generateMobileConfig({ certPem: SAMPLE_CERT });
    const expectedB64 = Buffer.from('sample-der-bytes').toString('base64');
    expect(config.replace(/\s/g, '')).toContain(expectedB64);
  });

  it('displayName/identifier를 반영한다', () => {
    const config = generateMobileConfig({
      certPem: SAMPLE_CERT,
      displayName: 'My CA',
      identifier: 'com.example.ca'
    });
    expect(config).toContain('My CA');
    expect(config).toContain('com.example.ca');
  });

  it('XML 특수문자를 이스케이프한다', () => {
    const config = generateMobileConfig({ certPem: SAMPLE_CERT, displayName: 'A & B <C>' });
    expect(config).toContain('A &amp; B &lt;C&gt;');
  });
});
