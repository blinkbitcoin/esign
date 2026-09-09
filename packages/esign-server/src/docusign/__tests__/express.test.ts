// DocuSign's pages on a bare Express router: the bridge always, the mock
// Web Forms page only with the mock's prefill lookup.

import express, { Router } from 'express';
import request from 'supertest';
import { mountDocuSignPages } from '../express';
import { LOCKED_FIELDS_HINT } from '../mockWebFormPage';

const app = (mockPages?: { getWebFormPrefill: () => undefined }) => {
  const router = Router();
  expect(mountDocuSignPages(router, mockPages && { mockPages })).toBe(router);
  return express().use(router);
};

describe('mountDocuSignPages', () => {
  it('serves the return-URL bridge under the signing-page CSP', async () => {
    const response = await request(app()).get(
      '/signing/return?event=ttl_expired',
    );
    expect(response.status).toBe(200);
    expect(response.headers['content-security-policy']).toMatch(
      /script-src 'nonce-/,
    );
    expect(response.text).toContain('postSigningEvent("session_timeout")');
  });

  it('serves the mock Web Forms page only when the mock pages are on', async () => {
    expect((await request(app()).get('/signing/mock-webform/x')).status).toBe(
      404,
    );
    const response = await request(
      app({ getWebFormPrefill: () => undefined }),
    ).get('/signing/mock-webform/x?country=Sweden');
    expect(response.status).toBe(200);
    expect(response.text).toContain('name="country" value="Sweden" />');
    expect(response.text).not.toContain(LOCKED_FIELDS_HINT);
  });
});
