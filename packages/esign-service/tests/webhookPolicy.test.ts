// The service's webhook policy as wired into the DocuSign adapter: the key
// is read from DOCUSIGN_HMAC_KEY on every call, and an unsigned webhook is
// accepted only when no key is configured - there is nothing to check.

import crypto from 'crypto';
import { vi } from 'vitest';
import { createProvider } from '../src/providers/docusign';

// One adapter for this file: the service builds a fresh one per app, so a
// test builds its own too
const DocuSignProvider = createProvider();

const sign = (body: string, key: string): string =>
  crypto.createHmac('sha256', key).update(body, 'utf8').digest('base64');

describe('DocuSignProvider.verifyWebhook policy', () => {
  const body = '{"data":{"envelopeId":"e","envelopeSummary":{"status":"completed"}}}';
  const originalKey = process.env.DOCUSIGN_HMAC_KEY;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    if (originalKey === undefined) delete process.env.DOCUSIGN_HMAC_KEY;
    else process.env.DOCUSIGN_HMAC_KEY = originalKey;
  });

  it('reads the key per call: a key set after boot is enforced', () => {
    process.env.DOCUSIGN_HMAC_KEY = 'k1';
    expect(
      DocuSignProvider.verifyWebhook({ 'x-docusign-signature-1': sign(body, 'k1') }, body)
    ).toBe(true);
    expect(
      DocuSignProvider.verifyWebhook({ 'x-docusign-signature-1': sign(body, 'other') }, body)
    ).toBe(false);
    process.env.DOCUSIGN_HMAC_KEY = 'k2';
    expect(
      DocuSignProvider.verifyWebhook({ 'x-docusign-signature-1': sign(body, 'k2') }, body)
    ).toBe(true);
  });

  // No key configured means there is no signature to check - which the boot
  // banner reported as an unverified webhook. A key that IS configured is
  // always enforced, whatever else the environment says.
  it('allows an unsigned webhook only when no key is configured', () => {
    delete process.env.DOCUSIGN_HMAC_KEY;
    expect(DocuSignProvider.verifyWebhook({}, body)).toBe(true);
    expect(warnSpy).toHaveBeenCalled();

    process.env.DOCUSIGN_HMAC_KEY = 'k1';
    expect(DocuSignProvider.verifyWebhook({}, body, '10.0.0.1')).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      'Security event:',
      expect.stringContaining('"ip":"10.0.0.1"')
    );
  });
});
