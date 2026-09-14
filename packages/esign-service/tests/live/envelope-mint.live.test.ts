// LIVE verification of the envelope mint against real DocuSign (demo): the
// service endpoint itself - POST /envelope/instance over createESignApp under
// ESIGN_MINT_MODE=envelope - not the client, on the fixture template
// `make docusign-template` creates (role `signer`, Text tabs `reference` +
// `notes`). Every run reads the envelope's tabs back from DocuSign: the value
// arrived on the document and the lock with it, which is the whole point of
// the feature, asserted rather than eyeballed.
//
// Opt-in exactly like the other live files: `npm run test:live` with the
// DocuSign env vars below set (DOCUSIGN_TEMPLATE_ID = the fixture); otherwise
// skipped. Each run creates three real envelopes on the demo account (status
// `sent`, DEMONSTRATION watermark); demo envelopes are throwaway.

import { createDocuSignClient } from '@blinkbitcoin/esign-node';
import { describe, expect, it, vi } from 'vitest';
import { createESignApp } from '../../src/app';
import type { Env } from '../../src/env';
import { getConfig } from '../../src/providers/docusign/config';
import { FIXTURE_TEXT_TABS } from '../../src/providers/docusign/template';

// The fixture's Text tabs: `reference` sits under the PDF's locked-terms
// section, `notes` under the optional one
const [REFERENCE, NOTES] = FIXTURE_TEXT_TABS;

const REQUIRED_ENV = [
  'DOCUSIGN_ACCOUNT_ID',
  'DOCUSIGN_INTEGRATION_KEY',
  'DOCUSIGN_PRIVATE_KEY',
  'DOCUSIGN_USER_ID',
  'DOCUSIGN_TEMPLATE_ID',
] as const;

const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.warn(
    `[live] Skipping DocuSign envelope mint live verification - missing: ${missing.join(', ')}`
  );
}

// The service as a live deployment would run it, minus what this test does
// not exercise: no database (the mint needs none), the dev passthrough for
// the session (the bearer token is the user id), the template(s) given
const liveEnv = (overrides: Env = {}): Env => ({
  ...process.env,
  DATABASE_URL: undefined,
  TERMS_URL: undefined,
  ESIGN_ENV: undefined,
  ESIGN_PROVIDER: 'docusign',
  ESIGN_MINT_MODE: 'envelope',
  ALLOW_INSECURE_DEV: 'true',
  ...overrides,
});

interface TextTab {
  tabLabel: string;
  value?: string;
  locked?: string;
  documentId?: string;
}

interface Signer {
  name: string;
  email: string;
  roleName?: string;
  tabs?: { textTabs?: TextTab[] };
}

// DocuSign's own record of the envelope, read with the service's grant
const readEnvelope = async <T>(envelopeId: string, path: string): Promise<T> => {
  const config = getConfig();
  const token = await createDocuSignClient(config).getAccessToken();
  const response = await fetch(
    `${config.apiBaseUrl}/v2.1/accounts/${config.accountId}/envelopes/${envelopeId}/${path}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  if (!response.ok) {
    throw new Error(`GET ${path} -> ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
};

const signersOf = async (envelopeId: string): Promise<Signer[]> =>
  (await readEnvelope<{ signers: Signer[] }>(envelopeId, 'recipients?include_tabs=true')).signers;

const textTabs = (signer: Signer, label: string): TextTab[] =>
  (signer.tabs?.textTabs ?? []).filter((tab) => tab.tabLabel === label);

const mintThrough = async (
  app: ReturnType<typeof createESignApp>,
  body: unknown
): Promise<{ url: string; envelopeId: string }> => {
  const response = await app.fetch(
    new Request('http://localhost/envelope/instance', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer live-mint-user' },
      body: JSON.stringify(body),
    })
  );
  expect(response.status).toBe(200);
  const minted = (await response.json()) as { url: string; envelopeId: string };
  expect(minted.envelopeId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(new URL(minted.url).hostname).toMatch(/docusign\.(com|net)$/);
  return minted;
};

describe.runIf(missing.length === 0)('the envelope mint (live, demo account)', () => {
  it('puts the value on the document, locked where the caller locked it', async () => {
    const stamp = Date.now();
    const signer = { name: 'Live Mint', email: `live-mint-${stamp}@example.com` };
    const app = createESignApp(liveEnv());

    const { envelopeId } = await mintThrough(app, {
      recipient: signer,
      prefill: {
        [REFERENCE]: { value: `LIVE-${stamp}`, locked: true },
        [NOTES]: 'a note the signer may still edit',
      },
    });

    const signers = await signersOf(envelopeId);
    expect(signers).toHaveLength(1);
    expect(signers[0]).toMatchObject({ name: signer.name, email: signer.email });
    const [reference] = textTabs(signers[0], REFERENCE);
    expect(reference).toMatchObject({ value: `LIVE-${stamp}`, locked: 'true' });
    const [notes] = textTabs(signers[0], NOTES);
    expect(notes.value).toBe('a note the signer may still edit');
    expect(notes.locked).not.toBe('true');
  });

  it('sends several templates as one envelope, one signing session, the value on every document', async () => {
    const stamp = Date.now();
    const templateId = process.env.DOCUSIGN_TEMPLATE_ID as string;
    const app = createESignApp(liveEnv({ DOCUSIGN_TEMPLATE_ID: `${templateId}, ${templateId}` }));

    const { envelopeId } = await mintThrough(app, {
      recipient: { name: 'Live Multi', email: `live-multi-${stamp}@example.com` },
      prefill: { [REFERENCE]: { value: `MULTI-${stamp}`, locked: true } },
    });

    const { envelopeDocuments } = await readEnvelope<{
      envelopeDocuments: { type: string }[];
    }>(envelopeId, 'documents');
    expect(envelopeDocuments.filter((document) => document.type === 'content')).toHaveLength(2);
    const signers = await signersOf(envelopeId);
    expect(signers).toHaveLength(1);
    const references = textTabs(signers[0], REFERENCE);
    expect(references).toHaveLength(2);
    expect(new Set(references.map((tab) => tab.documentId)).size).toBe(2);
    for (const tab of references) {
      expect(tab).toMatchObject({ value: `MULTI-${stamp}`, locked: 'true' });
    }
  });

  it('lets TERMS_URL name the signer and the locked value, whatever the caller sent', async () => {
    const stamp = Date.now();
    const host = {
      recipient: { name: 'Host Named', email: `live-host-${stamp}@example.com` },
      prefill: { [REFERENCE]: { value: `HOST-${stamp}`, locked: true } },
    };
    // The host's terms endpoint, stubbed: DocuSign is real, the host is not
    const terms = vi.fn(async () => new Response(JSON.stringify(host)));
    const app = createESignApp(liveEnv({ TERMS_URL: 'https://terms.example.com/esign' }), {
      fetch: terms as unknown as typeof globalThis.fetch,
    });

    const { envelopeId } = await mintThrough(app, {
      recipient: { name: 'Caller Named', email: `live-caller-${stamp}@example.com` },
      prefill: { [REFERENCE]: { value: 'CALLER', locked: true } },
    });

    expect(terms).toHaveBeenCalledTimes(1);
    const signers = await signersOf(envelopeId);
    expect(signers).toHaveLength(1);
    expect(signers[0]).toMatchObject(host.recipient);
    expect(textTabs(signers[0], REFERENCE)[0]).toMatchObject({
      value: `HOST-${stamp}`,
      locked: 'true',
    });
  });
});
