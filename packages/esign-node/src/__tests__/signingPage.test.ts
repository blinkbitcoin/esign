import {
  signingPageCsp,
  signingPageNonce,
  signingPageResponse,
} from '../signingPage';

describe('signingPageCsp', () => {
  it('allows only the nonced inline script and style, framed by anyone', () => {
    expect(signingPageCsp('abc')).toBe(
      "default-src 'none'; script-src 'nonce-abc'; style-src 'nonce-abc'; frame-ancestors *",
    );
  });
});

describe('signingPageNonce', () => {
  it('is 16 random bytes in base64, fresh per call', () => {
    const nonce = signingPageNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(Buffer.from(nonce, 'base64')).toHaveLength(16);
    expect(signingPageNonce()).not.toBe(nonce);
  });
});

describe('signingPageResponse', () => {
  it('renders the page with a nonce the CSP header allows, as HTML', async () => {
    const render = jest.fn((nonce: string) => `<script nonce="${nonce}">`);
    const response = signingPageResponse(render);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(
      'text/html; charset=utf-8',
    );
    const nonce = render.mock.calls[0][0];
    expect(nonce).toBe(nonce.trim());
    expect(response.headers.get('content-security-policy')).toBe(
      signingPageCsp(nonce),
    );
    expect(await response.text()).toBe(`<script nonce="${nonce}">`);
  });
});
