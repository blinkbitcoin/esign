// Proxy mode against REAL DocuSign inside the web component: the demo
// creates an envelope from the template through the live service, the
// ESignature iframe loads DocuSign's embedded signing ceremony, this spec
// signs there like a signer would, DocuSign redirects the frame to the
// service's return-URL bridge, and the bridge's postMessage completes the
// component - the whole journey, end to end, with a real signature.
// Opt-in (E2E_LIVE_API_ORIGIN, see playwright.proxy-live-demo.config.ts).

import { test, expect, type FrameLocator, type Page } from '@playwright/test';

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

  const frame = signingFrame(page);
  // 1. The e-signature disclosure - shown once per recipient; a recipient
  //    who accepted it on an earlier envelope lands on the document directly
  const consent = frame.getByRole('checkbox', {
    name: /agree to use electronic/i,
  });
  const signHere = frame.getByRole('button', { name: /required - sign here/i });
  await expect(consent.or(signHere).first()).toBeVisible({ timeout: 60_000 });
  if (await consent.count()) {
    await consent.click({ force: true });
    await frame.getByRole('button', { name: /^continue$/i }).click();
  }
  // 2. The document with its one required Sign Here tab
  await expect(
    frame.getByRole('button', { name: /required - sign here/i }),
  ).toBeVisible({ timeout: 60_000 });
  await frame.getByRole('button', { name: /required - sign here/i }).click();
  // 3. Adopt a signature (DocuSign prefills the recipient's name) - unless
  //    this recipient adopted one on an earlier envelope, in which case the
  //    click above applied it directly
  const adopt = frame.getByRole('button', { name: /adopt and sign/i });
  const applied = frame.getByRole('button', { name: /signature applied/i });
  await expect(adopt.or(applied).first()).toBeVisible({ timeout: 30_000 });
  if (await adopt.count()) {
    await expect(frame.getByRole('textbox', { name: 'Full Name' })).toHaveValue(
      'Test User',
    );
    await adopt.click();
  }
  await expect(applied).toBeVisible();
  // 4. Finish → DocuSign redirects the frame to the return-URL bridge
  //    (DOCUSIGN_RETURN_URL) → the bridge posts signing_complete → the
  //    component resolves → the demo shows its success screen
  await frame
    .getByRole('button', { name: /^finish$/i })
    .first()
    .click();
  await expect(page.getByTestId('success-screen')).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId('outcome')).toContainText('Document signed!');
  await page.screenshot({
    path: 'test-results/proxy-live-signed.png',
    fullPage: true,
  });
});
