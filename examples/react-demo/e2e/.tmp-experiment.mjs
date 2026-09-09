// Scratch experiment (not committed): mint instances with different params
// and submit each through the real form; report what DocuSign answers.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(process.argv[2], 'utf8')
    .split('\n')
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')];
    }),
);
// multi-line PEM: re-read raw
const raw = readFileSync(process.argv[2], 'utf8');
env.DOCUSIGN_PRIVATE_KEY = raw.slice(
  raw.indexOf('-----BEGIN'),
  raw.indexOf('-----END RSA PRIVATE KEY-----') + 29,
);
const { createWebFormInstance, docuSignConfigFromEnv } = await import(
  '../../../packages/esign-server/dist/index.mjs'
);
const config = docuSignConfigFromEnv(env);
const FULL = {
  Signer_name: 'Test User',
  Signer_email: 'test@example.com',
  full_name: 'Test User',
  email: 'test@example.com',
  country: 'Sweden',
  newsletter: 'yes',
  reference: 'E2E-0001',
  plan: 'seed',
  number_of_units: 1000,
  total_subscription_usd: 1000,
  settlement_amount_btc: 0.01,
  btc_usd_rate: 78850,
  rate_timestamp: '2026-09-08 10:44',
  settlement_date: '2026-09-10',
  phone: '+1 555 123 4567',
};
const LOCKED_ONLY = Object.fromEntries(
  Object.entries(FULL).filter(([k]) =>
    [
      'reference',
      'plan',
      'number_of_units',
      'total_subscription_usd',
      'settlement_amount_btc',
      'btc_usd_rate',
      'rate_timestamp',
      'settlement_date',
    ].includes(k),
  ),
);
const variants = [
  [
    'full prefill + returnUrl',
    { prefill: FULL, returnUrl: 'http://localhost:4010/signing/return' },
  ],
  ['full prefill, no returnUrl', { prefill: FULL, returnUrl: undefined }],
  [
    'locked-only prefill, no returnUrl',
    { prefill: LOCKED_ONLY, returnUrl: undefined },
  ],
  [
    'locked-only prefill, https returnUrl',
    { prefill: LOCKED_ONLY, returnUrl: 'https://example.com/signing/return' },
  ],
];
const browser = await chromium.launch();
for (const [name, opts] of variants) {
  const { url, instanceId } = await createWebFormInstance({
    config: { ...config, returnUrl: opts.returnUrl },
    userId: `exp-${Date.now()}`,
    prefill: opts.prefill,
    returnUrl: opts.returnUrl,
  });
  const page = await browser.newPage({
    viewport: { width: 480, height: 1000 },
  });
  await page.goto(url);
  await page.getByRole('button', { name: 'Start' }).click({ timeout: 60000 });
  for (let step = 0; step < 20; step++) {
    await page
      .locator('input, select, textarea, h1')
      .first()
      .waitFor({ timeout: 30000 });
    if ((await page.locator('input, select, textarea').count()) === 0) break;
    // fill empty required editable text fields
    for (const el of await page
      .locator('input[type="text"], input[type="email"], input:not([type])')
      .all()) {
      if ((await el.isEditable()) && (await el.inputValue()) === '') {
        const name = (await el.getAttribute('aria-label')) ?? '';
        await el.fill(
          /mail/i.test(name)
            ? 'test@example.com'
            : /country/i.test(name)
              ? 'Sweden'
              : 'Test User',
        );
      }
    }
    const h = await page.locator('h1').first().textContent();
    await page.getByRole('button', { name: 'Next' }).click();
    await page
      .waitForFunction(
        prev => document.querySelector('h1')?.textContent !== prev,
        h,
        { timeout: 15000 },
      )
      .catch(() => {});
  }
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(9000);
  const heading = await page
    .locator('h1')
    .first()
    .textContent()
    .catch(() => '(none)');
  const alert = await page
    .getByRole('status')
    .textContent()
    .catch(() => '');
  console.log(
    `[${name}] instance ${instanceId} → h1="${heading}" alert="${(alert ?? '').trim()}" url=${page.url().slice(0, 80)}`,
  );
  await page.screenshot({
    path: `${process.env.OUT}/exp-${name.replace(/[^a-z]+/gi, '-')}.png`,
    fullPage: true,
  });
  await page.close();
}
await browser.close();
