// E2E for the Web Forms instance flow over real HTTP (no DB involved): mint a
// prefilled instance, then fetch the page the minted URL points at and check
// the sender's values are shown locked - the guarantee a host relies on when
// it puts the economic terms of a document into the prefill.

import { LOCKED_FIELDS_HINT } from '@blinkbitcoin/esign-node';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../src/app';

describe('Web Forms instance E2E', () => {
  let app: Express;

  beforeAll(async () => {
    app = await createApp();
  });

  it('mints an instance whose page shows the prefill as locked fields', async () => {
    const prefill = {
      full_name: 'Jane Signer',
      number_of_units: 1000,
      total_subscription_usd: 1000,
      settlement_amount_btc: 0.01268231,
      rate_timestamp: '2026-09-08 10:44',
    };

    const minted = await request(app)
      .post('/webform/instance')
      .set('authorization', 'Bearer e2e-webform-user')
      .send({ prefill });
    expect(minted.status).toBe(200);
    expect(minted.body.instanceId).toMatch(/[0-9a-f-]{36}/);

    const url = new URL(minted.body.url);
    const page = await request(app).get(`${url.pathname}${url.search}`);
    expect(page.status).toBe(200);
    expect(page.type).toBe('text/html');

    // Every prefilled field is rendered read-only with the minted value
    const inputs = [...page.text.matchAll(/<input [^>]*>/g)].map((m) => m[0]);
    expect(inputs).toHaveLength(Object.keys(prefill).length);
    for (const [name, value] of Object.entries(prefill)) {
      const input = inputs.find((tag) => tag.includes(`name="${name}"`));
      expect(input).toContain(`value="${value}"`);
      expect(input).toContain('readonly');
    }
    expect(page.text).toContain(LOCKED_FIELDS_HINT);
  });

  it('keeps instances apart: a second instance does not see the first prefill', async () => {
    const first = await request(app)
      .post('/webform/instance')
      .set('authorization', 'Bearer e2e-webform-user')
      .send({ prefill: { units: 1 } });
    const second = await request(app)
      .post('/webform/instance')
      .set('authorization', 'Bearer e2e-webform-user')
      .send({ prefill: { units: 2 } });

    const secondPage = await request(app).get(new URL(second.body.url).pathname);
    expect(secondPage.text).toContain('name="units" value="2" readonly');
    expect(secondPage.text).not.toContain('value="1"');
    expect(first.body.instanceId).not.toBe(second.body.instanceId);
  });

  it('refuses a prefill outside the documented contract with 400', async () => {
    const response = await request(app)
      .post('/webform/instance')
      .set('authorization', 'Bearer e2e-webform-user')
      .send({ prefill: ['not', 'an', 'object'] });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid prefill: prefill must be an object');
  });
});
