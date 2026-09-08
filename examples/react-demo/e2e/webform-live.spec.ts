// LIVE browser E2E against a real DocuSign Web Form (demo account).
//
// Proves, in a real browser, the guarantee the mock suites model: values
// minted with the instance (createInstance formValues) populate the form's
// READ-ONLY fields, and the signer cannot change them. Opt-in via env:
//
//   E2E_LIVE_WEBFORM_URL    a minted instance URL (formUrl#instanceToken=...)
//                           - or, to mint one here -
//   E2E_LIVE_API_ORIGIN     a running backend with ESIGN_PROVIDER=docusign
//   E2E_LIVE_AUTH_TOKEN     bearer for POST /webform/instance (default: e2e-live,
//                           the dev passthrough userId)
//   E2E_LIVE_PREFILL        JSON object: field API reference name → value
//                           (numbers unquoted for Number fields)
//   E2E_LIVE_LOCKED_LABELS  JSON object: form label → expected displayed value
//                           for the fields marked read-only in the builder
//
// Without E2E_LIVE_WEBFORM_URL or E2E_LIVE_API_ORIGIN every test skips.
// Instance tokens expire ~5 minutes after minting - run promptly, or let the
// spec mint. A full-page screenshot lands in test-results/webform-live.png.

import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

// The spec runs under Node (Playwright), but the demo's tsconfig has no node
// types (it is a browser app); declare the one global we read.
declare const process: { env: Record<string, string | undefined> };

type Prefill = Record<string, unknown>;

const readJsonEnv = (name: string): Prefill => {
  const raw = process.env[name];
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as Prefill;
  } catch (error) {
    throw new Error(
      `${name} must be a JSON object: ${(error as Error).message}`,
    );
  }
};

const FORM_URL = process.env.E2E_LIVE_WEBFORM_URL;
const API_ORIGIN = process.env.E2E_LIVE_API_ORIGIN;
const AUTH_TOKEN = process.env.E2E_LIVE_AUTH_TOKEN ?? 'e2e-live';
const PREFILL = readJsonEnv('E2E_LIVE_PREFILL');
const LOCKED_LABELS = readJsonEnv('E2E_LIVE_LOCKED_LABELS');

test.skip(
  !FORM_URL && !API_ORIGIN,
  'set E2E_LIVE_WEBFORM_URL or E2E_LIVE_API_ORIGIN to run against real DocuSign',
);

// Mint an instance the way a host backend integration does
const mintInstanceUrl = async (request: APIRequestContext): Promise<string> => {
  const response = await request.post(`${API_ORIGIN}/webform/instance`, {
    headers: { authorization: `Bearer ${AUTH_TOKEN}` },
    data: { prefill: PREFILL },
  });
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as { url: string };
  expect(body.url).toMatch(/#instanceToken=.+/);
  return body.url;
};

// Wait for the DocuSign form to render its fields
const openForm = async (page: Page, url: string) => {
  await page.goto(url);
  await expect(page.locator('input').first()).toBeVisible({ timeout: 60_000 });
};

const displayedValues = (page: Page): Promise<string[]> =>
  page
    .locator('input')
    .evaluateAll(inputs =>
      inputs.map(input => (input as HTMLInputElement).value),
    );

test('live web form: minted prefill is shown, read-only fields cannot be changed', async ({
  page,
  request,
}) => {
  const url = FORM_URL ?? (await mintInstanceUrl(request));
  await openForm(page, url);

  // Every scalar prefill value is displayed somewhere in the form
  const shown = await displayedValues(page);
  for (const [name, value] of Object.entries(PREFILL)) {
    if (typeof value === 'string' || typeof value === 'number') {
      expect(shown, `prefill "${name}" should be displayed`).toContain(
        String(value),
      );
    }
  }

  // Fields marked read-only in the builder show the minted value and refuse
  // input (DocuSign renders them disabled or readonly)
  for (const [label, expected] of Object.entries(LOCKED_LABELS)) {
    const field = page.getByLabel(label, { exact: true }).first();
    await expect(field, `field "${label}"`).toHaveValue(String(expected));
    const locked = await field.evaluate(
      el =>
        (el as HTMLInputElement).readOnly || (el as HTMLInputElement).disabled,
    );
    expect(locked, `field "${label}" should be read-only`).toBe(true);
  }

  await page.screenshot({
    path: 'test-results/webform-live.png',
    fullPage: true,
  });
});
