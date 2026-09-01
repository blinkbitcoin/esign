// Tests for the embedded signing pages: the mock provider's signing page and
// the real-DocuSign return-URL bridge. These are the pages that speak the
// postMessage protocol the client components listen for - the layer the
// original test suite never covered (it simulated the messages directly).

import request from 'supertest';
import { vi } from 'vitest';

vi.mock('../src/envelope');
vi.mock('../src/audit');
vi.mock('../src/db', () => ({
  knex: { transaction: (cb: (trx: unknown) => unknown) => cb({}) },
}));

import type { Express } from 'express';
import { createApp } from '../src/app';
import {
  CLIENT_EVENTS,
  mapDocuSignReturnEvent,
  renderMockSigningPage,
  renderSigningReturnBridge,
} from '../src/signingPages';

describe('mapDocuSignReturnEvent', () => {
  it.each([
    ['signing_complete', 'signing_complete'],
    ['cancel', 'cancel'],
    ['decline', 'decline'],
    ['session_timeout', 'session_timeout'],
    ['ttl_expired', 'session_timeout'], // DocuSign's expiry event maps to our timeout
  ])('maps DocuSign %s to %s', (docusign, ours) => {
    expect(mapDocuSignReturnEvent(docusign)).toBe(ours);
  });

  it('maps unknown, missing, and malicious values to exception', () => {
    expect(mapDocuSignReturnEvent('viewing_complete')).toBe('exception');
    expect(mapDocuSignReturnEvent(undefined)).toBe('exception');
    expect(mapDocuSignReturnEvent('<script>alert(1)</script>')).toBe('exception');
  });

  it('only ever returns events the client components handle', () => {
    for (const raw of ['signing_complete', 'ttl_expired', 'garbage', '']) {
      expect(CLIENT_EVENTS).toContain(mapDocuSignReturnEvent(raw));
    }
  });
});

describe('renderMockSigningPage', () => {
  it('speaks the full client event protocol via both host mechanisms', () => {
    const html = renderMockSigningPage('env-123');

    // Both embedding hosts are addressed
    expect(html).toContain('window.ReactNativeWebView.postMessage');
    expect(html).toContain('window.parent.postMessage');

    // Every interactive event the components handle is wired via data-event
    // (no inline onclick, so the page works under a strict nonce-based CSP)
    expect(html).toContain('data-event="signing_complete"');
    expect(html).toContain('data-event="cancel"');
    expect(html).toContain('data-event="decline"');
    expect(html).toContain('data-event="session_timeout"');
    expect(html).toContain('addEventListener');

    expect(html).toContain('Envelope env-123');
  });

  it('sanitizes envelope IDs (no HTML/JS injection via the URL)', () => {
    const html = renderMockSigningPage('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('Envelope unknown');
  });

  it('applies the CSP nonce to its script and style tags', () => {
    const html = renderMockSigningPage('env-123', 'test-nonce-xyz');
    expect(html).toContain('<script nonce="test-nonce-xyz">');
    expect(html).toContain('<style nonce="test-nonce-xyz">');
  });
});

describe('renderSigningReturnBridge', () => {
  it('forwards the mapped event as a postMessage on load', () => {
    const html = renderSigningReturnBridge('signing_complete');
    expect(html).toContain('postSigningEvent("signing_complete")');
    expect(html).toContain('window.ReactNativeWebView.postMessage');
    expect(html).toContain('window.parent.postMessage');
  });

  it('never interpolates raw query input into the page', () => {
    const html = renderSigningReturnBridge('"></script><script>alert(1)</script>');
    expect(html).not.toContain('alert(1)');
    expect(html).toContain('postSigningEvent("exception")');
  });

  it('escapes < in the embedded JSON so a value can never break out of <script>', () => {
    // Defense in depth: even though event is a fixed enum, the script-embed
    // helper must escape '<' (JSON.stringify does not), so no '</script>'
    // sequence can ever appear from the interpolated value.
    const html = renderSigningReturnBridge('signing_complete');
    expect(html).not.toMatch(/<\/script>\s*<script>alert/);
    expect(html).toContain('postSigningEvent("signing_complete")');
  });
});

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
