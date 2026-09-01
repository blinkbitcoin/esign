// Browser E2E: the same four journeys the Maestro suite drives on mobile,
// through a real Chromium, a real backend (mock provider), a real Postgres,
// and a real CROSS-ORIGIN iframe (app :5173, signing page :4000).

import { test, expect, type Page, type FrameLocator } from '@playwright/test';

const signingFrame = (page: Page): FrameLocator =>
  page.frameLocator('[data-testid="signing-iframe"]');

const startSigning = async (page: Page) => {
  await page.goto('/');
  await page.getByTestId('sign-document-button').click();
  await expect(page.getByTestId('signing-iframe')).toBeVisible();
  await expect(
    signingFrame(page).getByRole('button', { name: 'Complete Signing' }),
  ).toBeVisible();
};

test('launch smoke: app boots to the signing idle screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('sign-document-button')).toBeVisible();
  await expect(page.getByTestId('cancel-button')).toBeVisible();
});

test('happy path: sign in the embedded page, see success and the envelope ID', async ({
  page,
}) => {
  await startSigning(page);

  await signingFrame(page)
    .getByRole('button', { name: 'Complete Signing' })
    .click();

  // Component shows success immediately; onComplete fires after successDelayMs
  await expect(page.getByTestId('success-screen')).toBeVisible();
  await expect(page.getByTestId('outcome')).toContainText(
    'Document signed! Envelope:',
    {
      timeout: 5_000,
    },
  );
  // The reported ID is the internal UUID (never the provider's)
  await expect(page.getByTestId('outcome')).toContainText(/[0-9a-f-]{36}/);
});

test('cancel from inside the signing page returns to idle', async ({
  page,
}) => {
  await startSigning(page);

  await signingFrame(page).getByRole('button', { name: 'Cancel' }).click();

  await expect(page.getByTestId('outcome')).toHaveText(
    'Signing was cancelled.',
  );
  await expect(page.getByTestId('sign-document-button')).toBeVisible();
});

test('session timeout offers restart; restarting completes the same envelope', async ({
  page,
}) => {
  await startSigning(page);

  await signingFrame(page)
    .getByRole('button', { name: 'Simulate Session Timeout' })
    .click();

  // Restartable error state
  await expect(page.getByTestId('restart-button')).toBeVisible();
  await expect(page.getByTestId('error-message')).toHaveText(
    'Session expired, tap to restart',
  );

  // Restart: fresh signing URL for the preserved envelope
  await page.getByTestId('restart-button').click();
  await signingFrame(page)
    .getByRole('button', { name: 'Complete Signing' })
    .click();

  await expect(page.getByTestId('success-screen')).toBeVisible();
  await expect(page.getByTestId('outcome')).toContainText('Document signed!', {
    timeout: 5_000,
  });
});
