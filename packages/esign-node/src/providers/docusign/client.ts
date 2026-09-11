// The DocuSign client: one object per configuration, holding the token cache
// and the REST calls. Calls are single attempts - wrap them in withRetry (or
// use createWebFormInstance, which does) to get backoff on 5xx/429/network.

import { HttpError } from '../../http';
import type {
  EnvelopeTabPrefill,
  FetchLike,
  RecipientData,
  WebFormInstanceOptions,
  WebFormInstanceResult,
  WebFormPrefill,
} from '../../types';
import { createTokenProvider, defaultFetch, type TokenProvider } from './auth';
import { assertDocuSignConfig, type DocuSignConfig } from './config';

export interface DocuSignClientOptions {
  // Replace fetch (tests, custom agents)
  fetch?: FetchLike;
}

export interface DocuSignClient extends TokenProvider {
  readonly config: DocuSignConfig;
  // Envelope from the configured template, embedded signing for `recipient`,
  // carrying the values the host computed
  createEnvelopeFromTemplate(
    recipient: RecipientData,
    prefill?: EnvelopeTabPrefill,
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

/** What `make docusign-template` names its role, kept as the fallback. */
const DEFAULT_SIGNER_ROLE = 'signer';

/** One text tab as the envelopes API takes it: a value laid over the template's
 * tab of the same label, and optionally that tab's lock. */
interface TextTab {
  tabLabel: string;
  value: string;
  locked?: 'true' | 'false';
}

/**
 * The prefill as DocuSign's own text tabs.
 *
 * A property sent here overlays the template's, so `locked` is sent only when
 * the host said so: a bare value (or one without `locked`) keeps whatever lock
 * the template designer set, and an explicit `false` unlocks on purpose. It
 * travels as the string 'true' / 'false': the envelopes API takes its booleans
 * as strings, and a real boolean is accepted and then ignored, which would
 * leave the value editable with nothing to say it went wrong.
 */
const textTabsFrom = (prefill: EnvelopeTabPrefill): TextTab[] =>
  Object.entries(prefill).map(([tabLabel, entry]) => {
    const { value, locked } =
      typeof entry === 'string' ? { value: entry, locked: undefined } : entry;

    return {
      tabLabel,
      value,
      ...(locked === undefined ? {} : { locked: locked ? 'true' : 'false' }),
    };
  });

/** The signer as the envelopes API names a template role. */
interface TemplateRole {
  email: string;
  name: string;
  roleName: string;
  clientUserId: string;
  tabs?: { textTabs: TextTab[] };
}

/**
 * The templates `templateId` names, in the order the signer reads them.
 *
 * Blank entries are dropped, so a trailing comma or the spaces after one cannot
 * add a template nobody asked for.
 */
const templateIdsOf = (templateId: string | undefined): string[] =>
  (templateId ?? '')
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0);

/**
 * Each document of a multi-template envelope carries its own copy of the signer,
 * and DocuSign folds the copies that share a recipient id into one recipient:
 * one signing session across every document instead of one per document.
 */
const SIGNER_RECIPIENT_ID = '1';

/**
 * The part of the envelope that names its documents and who signs them.
 *
 * One template keeps the plain `templateId` + `templateRoles` shape. Several
 * become composite templates, each pairing a server template with an inline one
 * that carries the signer: the inline template has the higher sequence, so its
 * role and values are laid over the server template's. The same values go to
 * every document, and a document simply ignores a label it has no tab for.
 */
const templatesFor = (templateIds: string[], signer: TemplateRole) => {
  if (templateIds.length === 1) {
    return { templateId: templateIds[0], templateRoles: [signer] };
  }

  return {
    compositeTemplates: templateIds.map((templateId, index) => ({
      compositeTemplateId: String(index + 1),
      serverTemplates: [{ sequence: '1', templateId }],
      inlineTemplates: [
        {
          sequence: '2',
          recipients: {
            signers: [{ ...signer, recipientId: SIGNER_RECIPIENT_ID }],
          },
        },
      ],
    })),
  };
};

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

    async createEnvelopeFromTemplate(recipient, prefill) {
      // Checked against the ids the setting actually names, so one that names
      // nothing (a lone comma) is reported as missing just like an unset one
      const templateIds = templateIdsOf(config.templateId);
      assertDocuSignConfig({ ...config, templateId: templateIds.join(',') }, [
        'accountId',
        'templateId',
      ]);

      const signer: TemplateRole = {
        email: recipient.email,
        name: recipient.name,
        // The template names its own role; 'signer' is only the default the
        // repo's own fixture uses.
        roleName: config.signerRoleName || DEFAULT_SIGNER_ROLE,
        clientUserId: embeddedClientUserId(recipient), // embedded signing
        ...(prefill ? { tabs: { textTabs: textTabsFrom(prefill) } } : {}),
      };
      const data = await call<{ envelopeId: string }>(envelopesUrl(), {
        method: 'POST',
        body: { ...templatesFor(templateIds, signer), status: 'sent' },
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
