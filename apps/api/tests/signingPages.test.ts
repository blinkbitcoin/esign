// The signing pages as served by this service (the pages themselves are the
// package's and tested there): CSP nonce, routes, query handling.

import request from 'supertest';
import { vi } from 'vitest';

vi.mock('../src/envelope');
vi.mock('../src/audit');
vi.mock('../src/db', () => ({
  knex: { transaction: (cb: (trx: unknown) => unknown) => cb({}) },
}));

import type { Express } from 'express';
import { createApp } from '../src/app';

describe('signing page routes', () => {
  let app: Express;

  beforeAll(async () => {
    app = await createApp();
  });

  it('GET /signing/mock/:envelopeId serves the mock signing page', async () => {
    const response = await request(app).get('/signing/mock/abc-123');

    expect(response.status).toBe(200);
    expect(response.type).toBe('text/html');
    expect(response.text).toContain('Mock Signing Session');
    expect(response.text).toContain('Envelope abc-123');
  });

  it('GET /signing/return bridges the DocuSign redirect event', async () => {
    const response = await request(app).get('/signing/return?event=signing_complete');

    expect(response.status).toBe(200);
    expect(response.type).toBe('text/html');
    expect(response.text).toContain('postSigningEvent("signing_complete")');
  });

  it('GET /signing/return without an event forwards exception', async () => {
    const response = await request(app).get('/signing/return');

    expect(response.status).toBe(200);
    expect(response.text).toContain('postSigningEvent("exception")');
  });

  it('GET /signing/return with a repeated event param is treated as missing', async () => {
    const response = await request(app).get('/signing/return?event=signing_complete&event=cancel');

    expect(response.status).toBe(200);
    expect(response.text).toContain('postSigningEvent("exception")');
  });
});
