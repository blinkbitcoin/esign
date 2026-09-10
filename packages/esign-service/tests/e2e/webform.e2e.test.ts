// E2E for the Web Forms instance flow over real HTTP (no DB involved): mint a
// prefilled instance, then fetch the page the minted URL points at and check
// the sender's values are shown locked - the guarantee a host relies on when
// it puts the economic terms of a document into the prefill.

import { LOCKED_FIELDS_HINT } from '@blinkbitcoin/esign-node';
import { asJson, envApp, get, post } from '../support/app';

describe('Web Forms instance E2E', () => {
  const app = envApp();

  const mint = (prefill: unknown) =>
    post(app, '/webform/instance', { prefill }, { authorization: 'Bearer e2e-webform-user' });

  it('mints an instance whose page shows the prefill as locked fields', async () => {
    const prefill = {
      full_name: 'Jane Signer',
      number_of_units: 1000,
      total_subscription_usd: 1000,
      settlement_amount_btc: 0.01268231,
      rate_timestamp: '2026-09-08 10:44',
    };

    const minted = await mint(prefill);
    expect(minted.status).toBe(200);
    const instance = await asJson<{ instanceId: string; url: string }>(minted);
    expect(instance.instanceId).toMatch(/[0-9a-f-]{36}/);

    const url = new URL(instance.url);
    const page = await get(app, `${url.pathname}${url.search}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    const html = await page.text();

    // Every prefilled field is rendered read-only with the minted value
    const inputs = [...html.matchAll(/<input [^>]*>/g)].map((m) => m[0]);
    expect(inputs).toHaveLength(Object.keys(prefill).length);
    for (const [name, value] of Object.entries(prefill)) {
      const input = inputs.find((tag) => tag.includes(`name="${name}"`));
      expect(input).toContain(`value="${value}"`);
      expect(input).toContain('readonly');
    }
    expect(html).toContain(LOCKED_FIELDS_HINT);
  });

  it('keeps instances apart: a second instance does not see the first prefill', async () => {
    const first = await asJson<{ instanceId: string }>(await mint({ units: 1 }));
    const second = await asJson<{ instanceId: string; url: string }>(await mint({ units: 2 }));

    const secondPage = await (await get(app, new URL(second.url).pathname)).text();
    expect(secondPage).toContain('name="units" value="2" readonly');
    expect(secondPage).not.toContain('value="1"');
    expect(first.instanceId).not.toBe(second.instanceId);
  });

  it('refuses a prefill outside the documented contract with 400', async () => {
    const response = await mint(['not', 'an', 'object']);
    expect(response.status).toBe(400);
    expect(await asJson<{ error: string }>(response)).toEqual({
      error: 'Invalid prefill: prefill must be an object',
    });
  });
});
