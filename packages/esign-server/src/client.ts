// The DocuSign client: one object per configuration, holding the token cache
// and the REST calls. Calls are single attempts - wrap them in withRetry (or
// use createWebFormInstance, which does) to get backoff on 5xx/429/network.

import { assertDocuSignConfig, type DocuSignConfig } from './config';
import { createTokenProvider, defaultFetch, type TokenProvider } from './auth';
import { HttpError } from './http';
import type {
  FetchLike,
  RecipientData,
  WebFormInstanceOptions,
  WebFormInstanceResult,
  WebFormPrefill,
} from './types';

export interface DocuSignClientOptions {
  // Replace fetch (tests, custom agents)
  fetch?: FetchLike;
}

export interface DocuSignClient extends TokenProvider {
  readonly config: DocuSignConfig;
  // Envelope from the configured template, embedded signing for `recipient`
  createEnvelopeFromTemplate(
    recipient: RecipientData,
  ): Promise<{ envelopeId: string }>;
  // Embedded signing view URL for an envelope's recipient
  getEmbeddedSigningUrl(
    envelopeId: string,
    recipient: RecipientData,
  ): Promise<string>;
  // Raw envelope status string
  fetchEnvelopeStatus(envelopeId: string): Promise<{ status: string }>;
  // Web Forms Instances:createInstance for the configured form
  createWebFormInstanceRequest(
    clientUserId: string,
    prefill: WebFormPrefill,
    options?: WebFormInstanceOptions,
  ): Promise<WebFormInstanceResult>;
}

// clientUserId for embedded signing must match between envelope creation and
// the view request; the recipient email is that stable value
const embeddedClientUserId = (recipient: RecipientData): string =>
  recipient.email;

export const createDocuSignClient = (
  config: DocuSignConfig,
  options: DocuSignClientOptions = {},
): DocuSignClient => {
  const fetchImpl = options.fetch ?? defaultFetch;
  const tokens = createTokenProvider(config, fetchImpl);

  // Authenticated JSON call; non-2xx becomes HttpError
  const call = async <T>(
    url: string,
    init: { method: 'GET' | 'POST'; body?: unknown },
  ) => {
    const accessToken = await tokens.getAccessToken();
    const response = await fetchImpl(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.body !== undefined
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    if (!response.ok) {
      throw new HttpError(response.status, await response.text());
    }
    return (await response.json()) as T;
  };

  const envelopesUrl = () =>
    `${config.apiBaseUrl}/v2.1/accounts/${config.accountId}/envelopes`;

  return {
    config,
    getAccessToken: () => tokens.getAccessToken(),
    clearTokenCache: () => tokens.clearTokenCache(),

    async createEnvelopeFromTemplate(recipient) {
      assertDocuSignConfig(config, ['accountId', 'templateId']);
      const data = await call<{ envelopeId: string }>(envelopesUrl(), {
        method: 'POST',
        body: {
          templateId: config.templateId,
          templateRoles: [
            {
              email: recipient.email,
              name: recipient.name,
              roleName: 'signer',
              clientUserId: embeddedClientUserId(recipient), // embedded signing
            },
          ],
          status: 'sent',
        },
      });
      return { envelopeId: data.envelopeId };
    },

    async getEmbeddedSigningUrl(envelopeId, recipient) {
      assertDocuSignConfig(config, ['accountId', 'returnUrl']);
      const data = await call<{ url: string }>(
        `${envelopesUrl()}/${envelopeId}/views/recipient`,
        {
          method: 'POST',
          body: {
            returnUrl: config.returnUrl,
            authenticationMethod: 'none',
            email: recipient.email,
            userName: recipient.name,
            clientUserId: embeddedClientUserId(recipient), // must match envelope creation
          },
        },
      );
      return data.url;
    },

    async fetchEnvelopeStatus(envelopeId) {
      assertDocuSignConfig(config, ['accountId']);
      const data = await call<{ status: string }>(
        `${envelopesUrl()}/${envelopeId}`,
        {
          method: 'GET',
        },
      );
      return { status: data.status };
    },

    // Verified against the Web Forms API reference (2026-07, returnUrl 2026-09):
    //   POST {webFormsBaseUrl}/accounts/{accountId}/forms/{formId}/instances
    //   body { clientUserId (REQUIRED, <=100 chars), formValues, returnUrl?,
    //         expirationOffset? (hours) }
    //   returns { formUrl, instanceToken, id }; instanceToken expires ~5 min
    //   and travels in the URL fragment.
    async createWebFormInstanceRequest(
      clientUserId,
      prefill,
      instanceOptions = {},
    ) {
      assertDocuSignConfig(config, ['accountId', 'webFormId']);
      const data = await call<{
        formUrl: string;
        instanceToken: string;
        id?: string;
      }>(
        `${config.webFormsBaseUrl}/accounts/${config.accountId}/forms/${config.webFormId}/instances`,
        {
          method: 'POST',
          body: {
            clientUserId,
            formValues: prefill,
            ...(instanceOptions.returnUrl
              ? { returnUrl: instanceOptions.returnUrl }
              : {}),
            ...(instanceOptions.expirationOffsetHours !== undefined
              ? { expirationOffset: instanceOptions.expirationOffsetHours }
              : {}),
          },
        },
      );
      return {
        url: `${data.formUrl}#instanceToken=${data.instanceToken}`,
        instanceId: data.id,
      };
    },
  };
};
