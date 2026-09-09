// Proxy mode against REAL DocuSign inside the web component: the demo
// creates an envelope from the template through the live service, the
// ESignature iframe loads DocuSign's embedded signing ceremony, this spec
// signs there like a signer would, DocuSign redirects the frame to the
// service's return-URL bridge, and the bridge's postMessage completes the
// component - the whole journey, end to end, with a real signature.
// Opt-in (E2E_LIVE_API_ORIGIN, see playwright.proxy-live-demo.config.ts).

import { test, expect, type FrameLocator, type Page } from '@playwright/test';
import { signInCeremony } from './liveCeremony';

declare const process: { env: Record<string, string | undefined> };

const API_ORIGIN = process.env.E2E_LIVE_API_ORIGIN;

test.skip(
  !API_ORIGIN,
  'set E2E_LIVE_API_ORIGIN (a running service on the DocuSign provider) to run',
);

const signingFrame = (page: Page): FrameLocator =>
  page.frameLocator('[data-testid="signing-iframe"]');

test('live proxy signing inside the component: envelope, ceremony, signature, bridge', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('sign-document-button').click();
  await expect(page.getByTestId('signing-iframe')).toBeVisible({
    timeout: 60_000,
  });
  // The frame is DocuSign's embedded signing ceremony for the envelope the
  // service just created from the template
  const src = await page.getByTestId('signing-iframe').getAttribute('src');
  expect(src).toMatch(/^https:\/\/[^/]*docusign\.(net|com)\//);

  await signInCeremony(signingFrame(page));
  await expect(page.getByTestId('success-screen')).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId('outcome')).toContainText('Document signed!');
  await page.screenshot({
    path: 'test-results/proxy-live-signed.png',
    fullPage: true,
  });
});
