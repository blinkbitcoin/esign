// DocuSign's embedded signing ceremony, driven inside the component's iframe
// the way a signer would: disclosure (first envelope of a recipient only),
// the one required Sign Here tab, adopting a signature (first time only),
// Finish. Shared by the proxy live spec (envelope from a template) and the
// Web Forms live spec (the ceremony the form opens after its submission).

import { expect, type FrameLocator } from '@playwright/test';

export const signInCeremony = async (frame: FrameLocator): Promise<void> => {
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
  await expect(signHere).toBeVisible({ timeout: 60_000 });
  await signHere.click();
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
};
