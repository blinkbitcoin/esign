// LIVE verification against the real DocuSign Web Forms API (demo account).
//
// Opt-in: runs only via `npm run test:live` AND only when the DocuSign env
// vars below are set (typically from apps/api/.env); otherwise every test is
// skipped. Never part of `npm test` / CI - it needs credentials and network.
//
// This automates items 1 (JWT auth) and 4 (createInstance contract) of the
// live smoke-test checklist in docs/docusign-setup.md. Items 2/3/5/6 (return
// URL, webhooks, sessionEnd events, RN WebView) involve a browser and a human
// signer and stay manual - the minted URL is logged so the runner can continue
// the checklist from it.
//
// Calls the client layer directly (not the DocuSignProvider wrapper) so a
// contract mismatch fails with DocuSign's raw HTTP status + body instead of
// the provider's mapped generic error.

import { describe, expect, it } from 'vitest';

import { createWebFormInstanceRequest, getAccessToken } from '../../src/providers/docusign/client';

const REQUIRED_ENV = [
  'DOCUSIGN_ACCOUNT_ID',
  'DOCUSIGN_INTEGRATION_KEY',
  'DOCUSIGN_PRIVATE_KEY',
  'DOCUSIGN_USER_ID',
  'DOCUSIGN_WEBFORM_ID',
] as const;

const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.warn(`[live] Skipping DocuSign live verification - missing: ${missing.join(', ')}`);
}

describe.runIf(missing.length === 0)('DocuSign Web Forms API (live, demo account)', () => {
  it('authenticates via JWT and mints an instance with the contracted shape', async () => {
    const accessToken = await getAccessToken();
    expect(accessToken).toBeTruthy();

    const clientUserId = `live-smoke-${Date.now()}`;
    const result = await createWebFormInstanceRequest(accessToken, clientUserId, {});

    // The contract assumed by providers/docusign/client.ts:
    // { formUrl, instanceToken } -> url = formUrl#instanceToken=<token>
    const url = new URL(result.url);
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toMatch(/docusign\.(com|net)$/);
    expect(url.hash).toMatch(/^#instanceToken=.+/);
    if (result.instanceId !== undefined) {
      expect(typeof result.instanceId).toBe('string');
    }

    // The minted URL must actually be served (the token travels in the
    // fragment, so this GET exercises the form shell, not the session).
    const response = await fetch(`${url.origin}${url.pathname}${url.search}`);
    expect(response.ok).toBe(true);

    // Hand-off for the manual checklist items (docs/docusign-setup.md §5):
    // open this URL to observe sessionEnd events / return-URL behavior.
    console.log(`[live] Minted Web Forms instance (token expires ~5 min):\n${result.url}`);
  }, 30_000);
});
