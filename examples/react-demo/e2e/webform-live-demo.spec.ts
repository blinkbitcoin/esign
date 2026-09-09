// The real DocuSign Web Form INSIDE the web component: the demo (webform
// mode) mints an instance through the live service, the ESignature iframe
// loads the real form, and this spec drives it in the frame - proving what
// no other run does: DocuSign allows framing an instance, the component's
// mint path works against the real service from a browser (CORS included),
// and the locked terms arrive inside the frame. Opt-in (E2E_LIVE_API_ORIGIN,
// see playwright.webform-live-demo.config.ts).

import { test, expect, type FrameLocator, type Page } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> };

const API_ORIGIN = process.env.E2E_LIVE_API_ORIGIN;

test.skip(
  !API_ORIGIN,
  'set E2E_LIVE_API_ORIGIN (a running service on the DocuSign provider) to run',
);

const signingFrame = (page: Page): FrameLocator =>
  page.frameLocator('[data-testid="signing-iframe"]');

// Start → Next … until the Summary page (no inputs), like the raw-form walk
const walkToSummary = async (frame: FrameLocator): Promise<void> => {
  const start = frame.getByRole('button', { name: 'Start' });
  await expect(start).toBeVisible({ timeout: 60_000 });
  await start.click();
  for (let step = 0; step < 20; step++) {
    await expect(
      frame.locator('input, select, textarea, h1').first(),
    ).toBeVisible({ timeout: 30_000 });
    if ((await frame.locator('input, select, textarea').count()) === 0) {
      return;
    }
    const heading = await frame.locator('h1').first().textContent();
    await frame.getByRole('button', { name: 'Next' }).click();
    await expect
      .poll(() => frame.locator('h1').first().textContent(), {
        timeout: 15_000,
      })
      .not.toBe(heading);
  }
  throw new Error('the form did not reach its Summary page');
};

test('live web form inside the component: minted, framed, walked', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('sign-document-button').click();
  await expect(page.getByTestId('signing-iframe')).toBeVisible();

  const frame = signingFrame(page);
  // Framing works: the real form's welcome page rendered inside our iframe
  await expect(frame.getByRole('button', { name: 'Start' })).toBeVisible({
    timeout: 60_000,
  });
  const src = await page.getByTestId('signing-iframe').getAttribute('src');
  expect(src).toMatch(/^https:\/\/[^/]*docusign\.com\/.*#instanceToken=/);

  await walkToSummary(frame);
  await expect(frame.getByRole('heading', { name: 'Summary' })).toBeVisible();
  // The Summary lists every locked term with the minted value
  for (const value of [
    'E2E-0001',
    '1000',
    '0.01',
    '78850',
    '2026-09-08 10:44',
  ]) {
    await expect(frame.getByText(value).first()).toBeVisible();
  }
  await page.screenshot({
    path: 'test-results/webform-live-demo-summary.png',
    fullPage: true,
  });
  // Submission (Summary → Next) is deliberately not attempted: DocuSign's
  // demo environment refuses it for a form with read-only fields (422
  // UNPROCESSABLE_ERROR), see docs/integration/webforms.md.
});
