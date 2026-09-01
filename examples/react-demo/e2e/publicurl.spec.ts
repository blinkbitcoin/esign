// Browser E2E for the public-URL mode (createPublicUrlSource): the demo embeds
// a static published-form URL (no backend minting) in a real cross-origin
// iframe and drives it. The embedded page emits the real DocuSign sessionEnd
// vocabulary, proving the createPublicUrlSource + interpretDocuSignEvent path.

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

test('public-url mode: embeds the published form (no backend call)', async ({
  page,
}) => {
  await startSigning(page);
  await expect(signingFrame(page).getByText('Mock Web Form')).toBeVisible();
});

test('public-url happy path: complete signing', async ({ page }) => {
  await startSigning(page);
  await signingFrame(page)
    .getByRole('button', { name: 'Complete Signing' })
    .click();
  await expect(page.getByTestId('success-screen')).toBeVisible();
  await expect(page.getByTestId('outcome')).toContainText('Document signed!', {
    timeout: 5_000,
  });
});

test('public-url cancel: returns to idle', async ({ page }) => {
  await startSigning(page);
  await signingFrame(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('outcome')).toHaveText(
    'Signing was cancelled.',
  );
  await expect(page.getByTestId('sign-document-button')).toBeVisible();
});
