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

interface SeenField {
  label: string;
  name: string;
  value: string;
  locked: boolean;
}

// The fields on the current page: label (from <label for>, aria-label or
// aria-labelledby), value and whether the signer can change it
const fieldsOnPage = (page: Page): Promise<SeenField[]> =>
  page.locator('input, select, textarea').evaluateAll(elements =>
    elements.map(element => {
      const el = element as HTMLInputElement;
      const byFor = el.id
        ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
        : null;
      const byIds = el.getAttribute('aria-labelledby');
      const labelled = byIds
        ? byIds
            .split(/\s+/)
            .map(id => document.getElementById(id)?.textContent ?? '')
            .join(' ')
        : '';
      const label = (
        byFor?.textContent ??
        el.getAttribute('aria-label') ??
        labelled
      )
        .replace(/\s*\*\s*$/, '')
        .trim();
      return {
        label,
        name: el.name,
        value: el.value,
        locked: el.readOnly || el.disabled,
      };
    }),
  );

// A DocuSign Web Form opens on a welcome page and spreads its fields over
// pages; walk Start → Next … until Next is gone, collecting every field.
const walkForm = async (page: Page, url: string): Promise<SeenField[]> => {
  await page.goto(url);
  const start = page.getByRole('button', { name: 'Start' });
  await expect(start).toBeVisible({ timeout: 60_000 });
  await start.click();

  const seen: SeenField[] = [];
  for (let step = 0; step < 20; step++) {
    // A field page shows inputs; the closing Summary page shows only headings
    await expect(
      page.locator('input, select, textarea, h1').first(),
    ).toBeVisible({ timeout: 30_000 });
    if ((await page.locator('input, select, textarea').count()) === 0) {
      break;
    }
    seen.push(...(await fieldsOnPage(page)));
    const next = page.getByRole('button', { name: 'Next' });
    if ((await next.count()) === 0) {
      break;
    }
    const before = await page.title();
    await next.click();
    // The page title carries the section name; a validation error keeps the
    // page (title unchanged). Name the fields that blocked the walk rather
    // than failing later on a misleading assertion.
    try {
      await expect
        .poll(() => page.title(), { timeout: 10_000 })
        .not.toBe(before);
    } catch {
      const blocking = (await fieldsOnPage(page))
        .filter(field => field.value === '' && !field.locked)
        .map(field => field.label || field.name);
      throw new Error(
        `the form did not advance past "${before}"; empty editable fields on that page: ${blocking.join(', ')} - prefill the required ones (E2E_LIVE_PREFILL)`,
      );
    }
  }
  return seen;
};

test('live web form: minted prefill is shown, read-only fields cannot be changed', async ({
  page,
  request,
}) => {
  const url = FORM_URL ?? (await mintInstanceUrl(request));
  const fields = await walkForm(page, url);
  expect(fields.length).toBeGreaterThan(0);

  // Every scalar prefill value is displayed somewhere in the form. Date
  // fields are minted as ISO (2026-09-10) and rendered in the form's own
  // format (2026/09/10), so dates compare on their digits.
  const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  const digits = (value: string) => value.replace(/\D/g, '');
  const shown = fields.map(field => field.value);
  for (const [name, value] of Object.entries(PREFILL)) {
    if (typeof value === 'string' || typeof value === 'number') {
      const expected = String(value);
      const displayed = isIsoDate(expected)
        ? shown.some(candidate => digits(candidate) === digits(expected))
        : shown.includes(expected);
      expect(
        displayed,
        `prefill "${name}" (${expected}) should be displayed`,
      ).toBe(true);
    }
  }

  // Fields marked read-only in the builder show the minted value and refuse
  // input (DocuSign renders them readonly or disabled)
  for (const [label, expected] of Object.entries(LOCKED_LABELS)) {
    const field = fields.find(candidate => candidate.label === label);
    expect(field, `field "${label}" should exist`).toBeDefined();
    expect(field?.value, `field "${label}" value`).toBe(String(expected));
    expect(field?.locked, `field "${label}" should be read-only`).toBe(true);
  }

  await page.screenshot({
    path: 'test-results/webform-live.png',
    fullPage: true,
  });
});
