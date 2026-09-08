// LIVE verification against the real DocuSign Web Forms API (demo account).
//
// Opt-in: runs only via `npm run test:live` AND only when the DocuSign env
// vars below are set (typically from examples/full-service-demo/.env); otherwise every test is
// skipped. Never part of `npm test` / CI - it needs credentials and network.
//
// This automates items 1 (JWT auth) and 4 (createInstance contract) of the
// live smoke-test checklist in docs/integration/docusign-proxy.md. Items 2/3/5/6 (return
// URL, webhooks, sessionEnd events, RN WebView) involve a browser and a human
// signer and stay manual - the minted URL is logged so the runner can continue
// the checklist from it.
//
// Calls the client layer directly (not the DocuSignProvider wrapper) so a
// contract mismatch fails with DocuSign's raw HTTP status + body instead of
// the provider's mapped generic error.

import { createDocuSignClient, createWebFormInstance } from '@blinkbitcoin/esign-server';
import { describe, expect, it } from 'vitest';
import { getConfig } from '../../src/providers/docusign/config';

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
    const docusign = createDocuSignClient(getConfig());
    expect(await docusign.getAccessToken()).toBeTruthy();

    const clientUserId = `live-smoke-${Date.now()}`;
    const result = await docusign.createWebFormInstanceRequest(
      clientUserId,
      {},
      {
        returnUrl: getConfig().returnUrl,
      }
    );

    // The contract assumed by @blinkbitcoin/esign-server's client:
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

    // Hand-off for the manual checklist items (docs/integration/docusign-proxy.md §5):
    // open this URL to observe sessionEnd events / return-URL behavior.
    console.log(`[live] Minted Web Forms instance (token expires ~5 min):\n${result.url}`);
  }, 30_000);

  // Prefill against the real form: DOCUSIGN_LIVE_PREFILL is a JSON object of
  // field API reference name → value for the configured form (numbers unquoted
  // for Number fields). Proves the API accepts the typed formValues; open the
  // logged URL to see the read-only fields populated (or run the browser
  // live E2E: make e2e-web-webform-live).
  const livePrefill = process.env.DOCUSIGN_LIVE_PREFILL;
  it.runIf(livePrefill)(
    'mints an instance with typed prefill values',
    async () => {
      // The one-call path a host backend uses (validation + retry + returnUrl)
      const result = await createWebFormInstance({
        config: getConfig(),
        userId: `live-prefill-${Date.now()}`,
        prefill: JSON.parse(livePrefill as string),
      });
      expect(new URL(result.url).hash).toMatch(/^#instanceToken=.+/);
      console.log(`[live] Minted prefilled instance (token expires ~5 min):\n${result.url}`);
    },
    30_000
  );
});
