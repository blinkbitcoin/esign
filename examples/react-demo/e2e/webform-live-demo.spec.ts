// The real DocuSign Web Form INSIDE the web component: the demo (webform
// mode) mints an instance through the live service, the ESignature iframe
// loads the real form, and this spec drives it in the frame - proving what
// no other run does: DocuSign allows framing an instance, the component's
// mint path works against the real service from a browser (CORS included),
// the locked terms arrive inside the frame, and the submission goes
// through to a signed envelope. Opt-in (E2E_LIVE_API_ORIGIN, see
// playwright.webform-live-demo.config.ts).

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
    '0.01268231',
    '78850',
    '2026-09-08 10:44',
  ]) {
    await expect(frame.getByText(value).first()).toBeVisible();
  }
  await page.screenshot({
    path: 'test-results/webform-live-demo-summary.png',
    fullPage: true,
  });
});

// The whole Web Forms journey with locked terms, end to end: Summary → Next
// submits the form (DocuSign creates the envelope from the form's template
// and opens its signing ceremony in the same frame), the signer signs,
// Finish sends the frame to the return-URL bridge, the bridge posts
// completion and the component resolves. The fixture form types its locked
// amounts as TEXT fields: DocuSign's demo environment answers 422 to the
// submission of a form with read-only NUMBER fields
// (docs/integration/webforms.md, "Submitting a form with read-only fields").
test('live web form inside the component: submitted, signed, completed', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('sign-document-button').click();
  const frame = signingFrame(page);
  await walkToSummary(frame);
  let submitStatus = 0;
  page.on('response', response => {
    if (response.url().includes('/actions/')) {
      submitStatus = response.status();
      // What DocuSign support needs to look a refusal up server-side
      const headers = response.headers();
      console.log(
        `[live-demo] submission trace: x-docusign-tracetoken=${headers['x-docusign-tracetoken']} x-request-id=${headers['x-request-id']?.split(',')[0]} at ${new Date().toISOString()}`,
      );
    }
  });
  await frame.getByRole('button', { name: 'Next' }).click();
  await expect.poll(() => submitStatus, { timeout: 30_000 }).not.toBe(0);
  console.log(`[live-demo] submission answered ${submitStatus}`);
  expect(submitStatus, 'the form submission is accepted').toBeLessThan(400);
  await signInCeremony(frame);
  await expect(page.getByTestId('success-screen')).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId('outcome')).toContainText('Document signed!');
  await page.screenshot({
    path: 'test-results/webform-live-demo-signed.png',
    fullPage: true,
  });
});
