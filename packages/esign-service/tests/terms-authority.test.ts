// What TERMS_URL is sold as: with the callback configured, the host decides
// who signs and which values the signer cannot change. The boot guard
// (`src/config.ts`) accepts a production deployment on that basis alone, and
// deploy/k8s/secret.yaml tells operators "without it the caller names the
// signer".
//
// These tests hold the envelope mint to that promise at the provider
// boundary - what actually reaches `createEnvelope` is what the signer sees.
// They are written against the intended contract, not the current merge, so
// they FAIL on feat/envelope-mint as it stands (review findings 1-4).
//
// Nothing here is anyone's data: synthetic signers, synthetic amounts.

import { vi } from 'vitest';

import type { Env } from '../src/env';
import { createEnvelopeTerms } from '../src/terms';
import { asJson, post, silently, testApp } from './support/app';

const TERMS_URL = 'https://host.example.com/terms';
const mintHeaders = { authorization: 'Bearer user-1' };

// The signer the caller asks for, and the one the host verified
const caller = { name: 'Caller Named', email: 'caller@example.com' };
const hostSigner = { name: 'Verified Name', email: 'verified@example.com' };

// The one term this host computes. Every other tab of the template is a tab
// the host's reply does not name.
const hostTerms = { total_usd: { value: '1000.00', locked: true } };

const envelopeRequest = () =>
  new Request('https://api.example.com/envelope/instance', { method: 'POST' });

// A terms callback answering `reply`
const hostAnswering = (reply: unknown) => vi.fn(async () => new Response(JSON.stringify(reply)));

// An envelope-mint app whose provider records what it was asked to create
const appRecording = (reply: unknown) => {
  const createEnvelope = vi.fn(async () => ({
    envelopeId: 'env-1',
    signingUrl: 'https://sign.example.com/env-1',
  }));
  const app = testApp({ ESIGN_MINT_MODE: 'envelope', TERMS_URL } as Env, {
    fetch: hostAnswering(reply) as unknown as typeof globalThis.fetch,
    provider: { createEnvelope } as never,
  });
  // ALLOW_INSECURE_DEV prints its boot warning on the first request an app
  // serves, not while testApp builds it
  const mint = (body: unknown) =>
    silently(() => post(app, '/envelope/instance', body, mintHeaders));
  return { mint, createEnvelope };
};

// The signer and the prefill the provider was handed
const signerOf = (createEnvelope: ReturnType<typeof vi.fn>) => createEnvelope.mock.calls[0]?.[2];
const prefillOf = (createEnvelope: ReturnType<typeof vi.fn>) =>
  createEnvelope.mock.calls[0]?.[3] as Record<string, unknown> | undefined;

describe('TERMS_URL is the authority on what the signer cannot change', () => {
  // Finding 1. `createEnvelopeTerms` merges `{ ...client, ...host }`, so a tab
  // label the host's reply does not name keeps the caller's entry - including
  // its `locked` flag, which `textTabsFrom` forwards to DocuSign as an
  // overlay on the template tab's own property.
  it('does not let the caller lock a tab the host never named', async () => {
    const { mint, createEnvelope } = appRecording({ recipient: hostSigner, prefill: hostTerms });

    // A term the host never computed, presented to the signer as settled
    const response = await mint({
      recipient: caller,
      prefill: { fee_usd: { value: '0.00', locked: true } },
    });

    expect(response.status).toBe(200);
    expect(prefillOf(createEnvelope)?.fee_usd).not.toMatchObject({ locked: true });
  });

  // Finding 1, the other half: the lock travels with the value on envelopes
  // (unlike Web Forms, where it is a design-time property of the form), so
  // `locked: false` from the caller unlocks a tab the template designer
  // locked, and the signer can edit a term before signing.
  it('does not let the caller unlock a tab the template locked', async () => {
    const { mint, createEnvelope } = appRecording({ recipient: hostSigner, prefill: hostTerms });

    const response = await mint({
      recipient: caller,
      prefill: { rate: { value: '0.00', locked: false } },
    });

    expect(response.status).toBe(200);
    expect(prefillOf(createEnvelope)?.rate).not.toMatchObject({ locked: false });
  });

  // The same at the unit the merge lives in: no entry the host did not name
  // may carry a lock the host did not set.
  it('carries no lock the host did not set', async () => {
    const terms = createEnvelopeTerms(
      { url: TERMS_URL, timeoutMs: 1000 },
      { fetch: hostAnswering({ recipient: hostSigner, prefill: hostTerms }) as never }
    );

    const { prefill } = await terms({
      userId: 'user-1',
      recipient: caller,
      prefill: {
        fee_usd: { value: '0.00', locked: true },
        rate: { value: '0.00', locked: false },
      },
      request: envelopeRequest(),
    });

    for (const [label, entry] of Object.entries(prefill ?? {})) {
      if (label in hostTerms) continue;
      expect(entry).not.toHaveProperty('locked');
    }
  });

  // Finding 2. `parseReply` requires only `prefill`, so a host implementing
  // the documented Web-Forms-shaped reply leaves the caller's recipient in
  // force: the caller names who signs, and the host's locked terms are
  // addressed to an email of the caller's choosing.
  it('does not fall back to the caller as the signer when the host names none', async () => {
    const { mint, createEnvelope } = appRecording({ prefill: hostTerms });

    const response = await mint({ recipient: caller, prefill: {} });

    expect(response.status).toBe(200);
    expect(signerOf(createEnvelope)).not.toEqual(caller);
  });

  // Finding 3. Without the callback an absent prefill leaves `prefill`
  // undefined and `createEnvelopeFromTemplate` omits the `tabs` key. With the
  // callback, `input = prefill ?? {}` merged with an empty reply is `{}` -
  // truthy - so the same intent posts `tabs: { textTabs: [] }` instead.
  it('asks for the same envelope as the no-callback path when nobody sets a term', async () => {
    const { mint, createEnvelope } = appRecording({ recipient: hostSigner, prefill: {} });

    const response = await mint({ recipient: caller });

    expect(response.status).toBe(200);
    expect(prefillOf(createEnvelope)).toBeUndefined();
  });

  // Finding 4. `parseRequest` reads a non-object body as `{}`, so neither the
  // recipient nor the prefill check sees it. With a host supplying both, such
  // a request mints a real envelope instead of the 400 the kind promises
  // ("400 with the reason, before any provider call").
  it('refuses a body that is not an object', async () => {
    const { mint, createEnvelope } = appRecording({ recipient: hostSigner, prefill: hostTerms });

    const response = await mint(['not', 'an', 'object']);

    expect(response.status).toBe(400);
    expect(await asJson(response)).toMatchObject({ error: expect.stringContaining('body') });
    expect(createEnvelope).not.toHaveBeenCalled();
  });
});
