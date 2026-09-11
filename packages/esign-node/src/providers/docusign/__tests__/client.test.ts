import {
  fail,
  fakeFetch,
  ok,
  testConfig,
  token,
} from '../../../__tests__/support';
import { HttpError } from '../../../http';
import { createDocuSignClient } from '../client';
import { DocuSignConfigError } from '../config';

const recipient = { name: 'Jane Signer', email: 'jane@example.com' };

describe('createDocuSignClient', () => {
  it('creates an envelope from the template with an embedded signer', async () => {
    const { fetchImpl, calls, body } = fakeFetch([
      token(),
      ok({ envelopeId: 'env-1' }),
    ]);
    const client = createDocuSignClient(testConfig(), { fetch: fetchImpl });

    expect(await client.createEnvelopeFromTemplate(recipient)).toEqual({
      envelopeId: 'env-1',
    });
    expect(calls[1].url).toBe(
      'https://demo.docusign.net/restapi/v2.1/accounts/acct-1/envelopes',
    );
    expect(calls[1].init?.method).toBe('POST');
    expect(calls[1].init?.headers).toEqual({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json',
    });
    expect(body(1)).toEqual({
      templateId: 'tpl-1',
      templateRoles: [
        {
          email: 'jane@example.com',
          name: 'Jane Signer',
          roleName: 'signer',
          clientUserId: 'jane@example.com',
        },
      ],
      status: 'sent',
    });
  });

  // The prefill is what makes the envelope carry the host's own figures, and
  // `locked` is what stops the signer rewriting them. Both travel as text tabs:
  // the tab types are the template's business, and DocuSign takes the boolean
  // as a string (a real boolean is accepted and then ignored, which would leave
  // the value editable with nothing to say so).
  it('writes the prefill onto the role’s text tabs, locked as a string', async () => {
    const { fetchImpl, body } = fakeFetch([token(), ok({ envelopeId: 'e' })]);
    const client = createDocuSignClient(testConfig(), { fetch: fetchImpl });

    await client.createEnvelopeFromTemplate(recipient, {
      total_usd: { value: '10.00', locked: true },
      country: 'Honduras',
      note: { value: 'free to change' },
    });

    expect(body(1).templateRoles[0].tabs).toEqual({
      textTabs: [
        { tabLabel: 'total_usd', value: '10.00', locked: 'true' },
        { tabLabel: 'country', value: 'Honduras', locked: 'false' },
        { tabLabel: 'note', value: 'free to change', locked: 'false' },
      ],
    });
  });

  // A template names its own signing role; 'signer' is only what the repo's
  // own fixture calls it.
  it('signs under the configured role', async () => {
    const { fetchImpl, body } = fakeFetch([token(), ok({ envelopeId: 'e' })]);
    const client = createDocuSignClient(
      { ...testConfig(), signerRoleName: 'investor' },
      { fetch: fetchImpl },
    );

    await client.createEnvelopeFromTemplate(recipient);

    expect(body(1).templateRoles[0].roleName).toBe('investor');
  });

  // An agreement made of several documents is signed in one session: one
  // envelope whose documents follow the order configured, each carrying the
  // same signer under the same recipient id so DocuSign folds them into one.
  it('sends several templates as one envelope of composite templates', async () => {
    const { fetchImpl, body } = fakeFetch([token(), ok({ envelopeId: 'e' })]);
    const client = createDocuSignClient(
      { ...testConfig(), templateId: 'tpl-a,tpl-b,tpl-c' },
      { fetch: fetchImpl },
    );

    await client.createEnvelopeFromTemplate(recipient, { country: 'Honduras' });

    const signer = {
      email: 'jane@example.com',
      name: 'Jane Signer',
      roleName: 'signer',
      clientUserId: 'jane@example.com',
      recipientId: '1',
      tabs: {
        textTabs: [{ tabLabel: 'country', value: 'Honduras', locked: 'false' }],
      },
    };
    const composite = (id: string, templateId: string) => ({
      compositeTemplateId: id,
      serverTemplates: [{ sequence: '1', templateId }],
      inlineTemplates: [{ sequence: '2', recipients: { signers: [signer] } }],
    });
    expect(body(1)).toEqual({
      compositeTemplates: [
        composite('1', 'tpl-a'),
        composite('2', 'tpl-b'),
        composite('3', 'tpl-c'),
      ],
      status: 'sent',
    });
  });

  // A trailing comma or stray spaces must not add a template, nor turn a
  // single one into a composite envelope
  it('ignores blank entries in the template list', async () => {
    const { fetchImpl, body } = fakeFetch([token(), ok({ envelopeId: 'e' })]);
    const client = createDocuSignClient(
      { ...testConfig(), templateId: ' tpl-1 , ' },
      { fetch: fetchImpl },
    );

    await client.createEnvelopeFromTemplate(recipient);

    expect(body(1).templateId).toBe('tpl-1');
    expect(body(1)).not.toHaveProperty('compositeTemplates');
  });

  it('requests the embedded signing view with the same clientUserId', async () => {
    const { fetchImpl, calls, body } = fakeFetch([
      token(),
      ok({ url: 'https://sign/1' }),
    ]);
    const client = createDocuSignClient(testConfig(), { fetch: fetchImpl });

    expect(await client.getEmbeddedSigningUrl('env-1', recipient)).toBe(
      'https://sign/1',
    );
    expect(calls[1].url).toBe(
      'https://demo.docusign.net/restapi/v2.1/accounts/acct-1/envelopes/env-1/views/recipient',
    );
    expect(body(1)).toEqual({
      returnUrl: 'https://api.example.com/signing/return',
      authenticationMethod: 'none',
      email: 'jane@example.com',
      userName: 'Jane Signer',
      clientUserId: 'jane@example.com',
    });
  });

  it('fetches the envelope status with a GET and no body', async () => {
    const { fetchImpl, calls } = fakeFetch([
      token(),
      ok({ status: 'completed' }),
    ]);
    const client = createDocuSignClient(testConfig(), { fetch: fetchImpl });

    expect(await client.fetchEnvelopeStatus('env-1')).toEqual({
      status: 'completed',
    });
    expect(calls[1].url).toBe(
      'https://demo.docusign.net/restapi/v2.1/accounts/acct-1/envelopes/env-1',
    );
    expect(calls[1].init).toEqual({
      method: 'GET',
      headers: { Authorization: 'Bearer tok' },
    });
  });

  it('mints a Web Forms instance and builds the fragment URL', async () => {
    const { fetchImpl, calls, body } = fakeFetch([
      token(),
      ok({
        formUrl: 'https://apps-d.docusign.com/webforms/us/f1',
        instanceToken: 'TKN',
        id: 'inst-9',
      }),
    ]);
    const client = createDocuSignClient(testConfig(), { fetch: fetchImpl });
    const prefill = {
      full_name: 'Jane',
      units: 1000,
      alerts: ['a'],
      phone: { nationalNumber: '1' },
    };

    expect(
      await client.createWebFormInstanceRequest('user-42', prefill, {
        returnUrl: 'https://api.example.com/signing/return',
        expirationOffsetHours: 24,
      }),
    ).toEqual({
      url: 'https://apps-d.docusign.com/webforms/us/f1#instanceToken=TKN',
      instanceId: 'inst-9',
    });
    expect(calls[1].url).toBe(
      'https://apps-d.docusign.com/api/webforms/v1.1/accounts/acct-1/forms/form-1/instances',
    );
    expect(body(1)).toEqual({
      clientUserId: 'user-42',
      formValues: prefill,
      returnUrl: 'https://api.example.com/signing/return',
      expirationOffset: 24,
    });
    // Numbers travel unquoted (DocuSign Number fields reject quoted numbers)
    expect(String(calls[1].init?.body)).toContain('"units":1000,');
  });

  it('omits returnUrl and expirationOffset when not given, and instanceId when absent', async () => {
    const { fetchImpl, body } = fakeFetch([
      token(),
      ok({ formUrl: 'https://f', instanceToken: 'T' }),
    ]);
    const client = createDocuSignClient(testConfig(), { fetch: fetchImpl });
    expect(await client.createWebFormInstanceRequest('u', {})).toEqual({
      url: 'https://f#instanceToken=T',
      instanceId: undefined,
    });
    expect(body(1)).toEqual({ clientUserId: 'u', formValues: {} });
  });

  it('turns a non-2xx response into HttpError with the body', async () => {
    const { fetchImpl } = fakeFetch([token(), fail(400, 'bad form')]);
    const client = createDocuSignClient(testConfig(), { fetch: fetchImpl });
    await expect(client.createWebFormInstanceRequest('u', {})).rejects.toEqual(
      new HttpError(400, 'bad form'),
    );
  });

  it('propagates a failed token exchange without calling the API', async () => {
    const { fetchImpl, calls } = fakeFetch([fail(401, 'nope')]);
    const client = createDocuSignClient(testConfig(), { fetch: fetchImpl });
    await expect(client.fetchEnvelopeStatus('env-1')).rejects.toEqual(
      new HttpError(401, 'nope'),
    );
    expect(calls).toHaveLength(1);
  });

  it('shares the token across calls and exposes the cache controls', async () => {
    const { fetchImpl, calls } = fakeFetch([
      token('a'),
      ok({ status: 'sent' }),
      ok({ status: 'sent' }),
      token('b'),
      ok({ status: 'sent' }),
    ]);
    const client = createDocuSignClient(testConfig(), { fetch: fetchImpl });
    await client.fetchEnvelopeStatus('1');
    await client.fetchEnvelopeStatus('2');
    expect(await client.getAccessToken()).toBe('a');
    client.clearTokenCache();
    await client.fetchEnvelopeStatus('3');
    expect(calls.map(call => call.url.endsWith('/oauth/token'))).toEqual([
      true,
      false,
      false,
      true,
      false,
    ]);
    expect(client.config.accountId).toBe('acct-1');
  });

  it('fails fast on missing configuration for each operation', async () => {
    const { fetchImpl, calls } = fakeFetch([]);
    const noTemplate = createDocuSignClient(
      testConfig({ templateId: undefined }),
      { fetch: fetchImpl },
    );
    await expect(
      noTemplate.createEnvelopeFromTemplate(recipient),
    ).rejects.toThrow('DOCUSIGN_TEMPLATE_ID');
    const onlyCommas = createDocuSignClient(testConfig({ templateId: ' , ' }), {
      fetch: fetchImpl,
    });
    await expect(
      onlyCommas.createEnvelopeFromTemplate(recipient),
    ).rejects.toThrow('DOCUSIGN_TEMPLATE_ID');
    const noReturn = createDocuSignClient(
      testConfig({ returnUrl: undefined }),
      { fetch: fetchImpl },
    );
    await expect(
      noReturn.getEmbeddedSigningUrl('e', recipient),
    ).rejects.toThrow('DOCUSIGN_RETURN_URL');
    const noAccount = createDocuSignClient(
      testConfig({ accountId: undefined }),
      { fetch: fetchImpl },
    );
    await expect(noAccount.fetchEnvelopeStatus('e')).rejects.toBeInstanceOf(
      DocuSignConfigError,
    );
    const noForm = createDocuSignClient(testConfig({ webFormId: undefined }), {
      fetch: fetchImpl,
    });
    await expect(noForm.createWebFormInstanceRequest('u', {})).rejects.toThrow(
      'DOCUSIGN_WEBFORM_ID',
    );
    expect(calls).toHaveLength(0);
  });

  it('uses the global fetch when none is injected', async () => {
    const original = globalThis.fetch;
    const { fetchImpl } = fakeFetch([token(), ok({ status: 'sent' })]);
    globalThis.fetch = fetchImpl as unknown as typeof fetch;
    const client = createDocuSignClient(testConfig());
    expect(await client.fetchEnvelopeStatus('e')).toEqual({ status: 'sent' });
    globalThis.fetch = original;
  });
});
