// Minting a hosted-form instance through the host's own backend: the POST the
// app makes with its session token, so read-only fields come back locked
// with the sender's values. The backend holds the provider credentials
// (@blinkbitcoin/esign-server does the provider call); this is only the
// client half. Provider-neutral - a provider narrows the prefill shape via
// the generic. No Apollo/GraphQL dependency.

/** A prefill: field names → values; each provider narrows the value shape. */
export type HostedFormPrefill = Record<string, unknown>;

/** What the mint endpoint returns: the embeddable instance URL (+ its id). */
export interface HostedFormInstance {
  /** Embeddable instance URL. */
  url: string;
  /** Optional envelope/instance id echoed back to onComplete. */
  envelopeId?: string;
}

export interface MintHostedFormOptions {
  /** The host backend endpoint that mints an instance, e.g. POST /webform/instance. */
  url: string;
  /**
   * The app's session token for that backend - the same one its API client
   * sends. Sent as `Authorization: Bearer <token>`; omitted when it returns
   * nothing.
   */
  getAuthToken: () => string | undefined | Promise<string | undefined>;
  /** Extra request headers (e.g. a tenant header). */
  headers?: Record<string, string>;
  /** Replace fetch (tests, custom clients); defaults to the global. */
  fetch?: typeof fetch;
}

/** The instance URL reply the endpoint returns ({ url, instanceId? }). */
interface MintReply {
  url?: unknown;
  instanceId?: unknown;
  envelopeId?: unknown;
}

const stringOr = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/**
 * Build the `createInstance` call for createHostedFormSource from an endpoint
 * and a prefill. Mint right before opening the form: the instance token in
 * the returned URL is short-lived.
 */
export const createHostedFormMinter =
  <P extends HostedFormPrefill = HostedFormPrefill>(
    mint: MintHostedFormOptions,
    prefill?: P,
  ): (() => Promise<HostedFormInstance>) =>
  async () => {
    const token = await mint.getAuthToken();
    const doFetch = mint.fetch ?? fetch;
    const response = await doFetch(mint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...mint.headers,
      },
      body: JSON.stringify({ prefill: prefill ?? {} }),
    });
    if (!response.ok) {
      throw new Error(
        `Could not mint the signing instance (HTTP ${response.status})`,
      );
    }
    const reply = (await response.json()) as MintReply;
    const url = stringOr(reply.url);
    if (!url) {
      throw new Error('The mint endpoint returned no instance url');
    }
    return {
      url,
      envelopeId: stringOr(reply.envelopeId) ?? stringOr(reply.instanceId),
    };
  };
