// LIVE verification of the proxy/envelope mode against real DocuSign (demo).
//
// Opt-in exactly like webforms.live.test.ts: runs only via `npm run test:live`
// and only when the DocuSign env vars below are set (DOCUSIGN_TEMPLATE_ID
// instead of DOCUSIGN_WEBFORM_ID); otherwise skipped. Never part of CI.
//
// Automates item 1 of the live smoke-test checklist in docs/docusign-setup.md
// (JWT auth, template envelope creation, recipient view) and hands off to
// item 2: the logged signing URL is the entry to the return-URL bridge, so
// the runner can open it, sign, and capture the `?event=` redirect.
//
// Calls the client layer directly so a contract mismatch fails with
// DocuSign's raw HTTP status + body, not the provider's mapped error.
//
// Each run creates one real envelope on the demo account (status `sent`,
// DEMONSTRATION watermark). Demo envelopes are throwaway; no cleanup needed.

import { describe, expect, it } from 'vitest';

import {
  createEnvelopeFromTemplate,
  fetchEnvelopeStatus,
  getAccessToken,
  getEmbeddedSigningUrl,
} from '../../src/providers/docusign/client';

const REQUIRED_ENV = [
  'DOCUSIGN_ACCOUNT_ID',
  'DOCUSIGN_INTEGRATION_KEY',
  'DOCUSIGN_PRIVATE_KEY',
  'DOCUSIGN_USER_ID',
  'DOCUSIGN_TEMPLATE_ID',
] as const;

const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.warn(
    `[live] Skipping DocuSign envelope live verification - missing: ${missing.join(', ')}`
  );
}

describe.runIf(missing.length === 0)('DocuSign envelope API (live, demo account)', () => {
  it('authenticates, creates a template envelope, and mints a recipient view URL', async () => {
    const accessToken = await getAccessToken();
    expect(accessToken).toBeTruthy();

    // The template must have a role named exactly `signer` (checklist item 1);
    // a 400 here with a TEMPLATE_ROLE-ish error body means the dummy template
    // is set up wrong, not that the adapter is.
    const recipient = { name: 'Live Smoke', email: `live-smoke-${Date.now()}@example.com` };
    const { envelopeId } = await createEnvelopeFromTemplate(accessToken, recipient);
    expect(envelopeId).toMatch(/^[0-9a-f-]{36}$/i); // DocuSign envelope IDs are GUIDs

    // Freshly created from a template with status: 'sent'
    const { status } = await fetchEnvelopeStatus(accessToken, envelopeId);
    expect(status).toBe('sent');

    // Recipient view = the embedded signing ceremony URL. Single-use and
    // ~5 min TTL, so we verify shape without GETting it (a fetch would
    // consume it) and log it intact for the manual checklist items.
    const signingUrl = await getEmbeddedSigningUrl(accessToken, envelopeId, recipient);
    const url = new URL(signingUrl);
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toMatch(/docusign\.(com|net)$/);

    // Hand-off for checklist item 2 (docs/docusign-setup.md §5): open this
    // URL, complete/cancel/decline, and capture the `?event=` value on the
    // redirect to the return-URL bridge.
    console.log(
      `[live] Envelope ${envelopeId} created (sent). Signing ceremony URL (single-use, ~5 min):\n${signingUrl}`
    );
  }, 30_000);
});
