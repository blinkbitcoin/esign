// Browser E2E for the DocuSign Web Forms mode: the demo (webform mode) calls
// POST /webform/instance, embeds the returned mock-webform page in a real
// cross-origin iframe, and drives it. The mock page emits the REAL DocuSign
// event vocabulary ({ type: 'signingComplete' | ... }), so this proves the
// createWebFormsSource + interpretDocuSignEvent path end-to-end.

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

test('webform mode: mints an instance and shows the mock web form', async ({
  page,
}) => {
  await startSigning(page);
  // The embedded page is the mock DocuSign Web Form, not the proxy signing page
  await expect(signingFrame(page).getByText('Mock Web Form')).toBeVisible();
});

test('webform happy path: complete signing via the real DocuSign event', async ({
  page,
}) => {
  await startSigning(page);

  await signingFrame(page)
    .getByRole('button', { name: 'Complete Signing' })
    .click();

  await expect(page.getByTestId('success-screen')).toBeVisible();
  await expect(page.getByTestId('outcome')).toContainText('Document signed!', {
    timeout: 5_000,
  });
});

test('webform prefill: values minted with the instance are locked in the form', async ({
  page,
}) => {
  await startSigning(page);
  const frame = signingFrame(page);

  // The demo mints the instance with DEMO_PREFILL (src/App.tsx); the form
  // shows every value read-only - the signer cannot change the terms
  await expect(frame.getByLabel('full_name')).toHaveValue('Test User');
  await expect(frame.getByLabel('email')).toHaveValue('test@example.com');
  const units = frame.getByLabel('units');
  await expect(units).toHaveValue('10');
  await expect(units).toHaveJSProperty('readOnly', true);
  await expect(frame.getByLabel('total_usd')).toHaveValue('1000.5');
  await expect(frame.getByLabel('total_usd')).toHaveJSProperty(
    'readOnly',
    true,
  );
  await expect(
    frame.getByText(
      'Locked fields were set by the sender and cannot be edited.',
    ),
  ).toBeVisible();

  // Typing into a locked field changes nothing
  await units.click();
  await page.keyboard.type('999');
  await expect(units).toHaveValue('10');
});

test('webform cancel: returns to idle', async ({ page }) => {
  await startSigning(page);

  await signingFrame(page).getByRole('button', { name: 'Cancel' }).click();

  await expect(page.getByTestId('outcome')).toHaveText(
    'Signing was cancelled.',
  );
  await expect(page.getByTestId('sign-document-button')).toBeVisible();
});
