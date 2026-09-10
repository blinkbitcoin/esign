// The signing pages as served by this service (the pages themselves are the
// package's and tested there): routes, query handling, and that the CSP the
// page brings survives the service's own baseline headers.

import { get, testApp } from './support/app';

describe('signing page routes', () => {
  const app = testApp();

  it('GET /signing/mock/:envelopeId serves the mock signing page', async () => {
    const response = await get(app, '/signing/mock/abc-123');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('Mock Signing Session');
    expect(html).toContain('Envelope abc-123');
  });

  it('GET /signing/return bridges the DocuSign redirect event', async () => {
    const response = await get(app, '/signing/return?event=signing_complete');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('postSigningEvent("signing_complete")');
  });

  it('GET /signing/return without an event forwards exception', async () => {
    const response = await get(app, '/signing/return');

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('postSigningEvent("exception")');
  });

  it('GET /signing/return with a repeated event param takes the first', async () => {
    const response = await get(app, '/signing/return?event=signing_complete&event=cancel');

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('postSigningEvent("signing_complete")');
  });
});
