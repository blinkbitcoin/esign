// What the mint answers with: a Web Forms instance (the default, what every
// deployment ran before the choice existed) or an envelope created from the
// template. A deployment serves exactly one, named by ESIGN_MINT_MODE, and
// everything that differs between the two is one entry here - the provider
// selection the boot guard runs, what the production guard calls the terms
// the client sent, and the preset the app mounts. The rest of the service
// asks for the mode once and never which one it is; a third way to mint is
// a third entry, not a third branch.
//
// Neither needs a database. With envelope orchestration on (DATABASE_URL), an
// envelope the mint creates goes through the envelope domain, so it is stored
// and audited like one the GraphQL mutation created.

import {
  createEnvelopeApp,
  createHostedFormApp,
  type EnvelopeMintFn,
  type EnvelopeMintTarget,
  type EnvelopeProviderOptions,
  type EnvelopeService,
  envelopeMint,
  envelopeProviderFromEnv,
  type HostedFormApp,
  hostedFormProviderFromEnv,
} from '@blinkbitcoin/esign-node';

import type { Env } from './env';
import { createEnvelopePrefillHook, createPrefillHook, type PrefillConfig } from './prefill';
import type { ESignProvider } from './providers/port';

// The variable that names the mode
export const ESIGN_MINT_MODE = 'ESIGN_MINT_MODE';

export const MINT_MODE_NAMES = ['webform', 'envelope'] as const;

export type MintModeName = (typeof MINT_MODE_NAMES)[number];

// What createESignApp hands a mode to build its preset with
export interface MintDeps {
  provider: ESignProvider;
  authenticate: (request: Request) => Promise<string | null>;
  // The browser origins allowed to call the mint (none: same-origin only)
  origins: string[];
  // The host's terms endpoint, when ESIGN_PREFILL_URL is set
  terms?: PrefillConfig;
  // The fetch the terms callback uses (default: the platform's)
  fetch?: typeof globalThis.fetch;
  // The envelope domain's create, when orchestration is on: a mint that
  // creates envelopes creates through it
  envelopes?: Promise<Pick<EnvelopeService, 'createEnvelope'>>;
}

export interface MintMode {
  name: MintModeName;
  // What is minted as sent without ESIGN_PREFILL_URL, as the production guard names it
  clientPrefill: string;
  // The package's provider selection for this mint: the settings the mint
  // needs and the production checks, run at boot rather than on the first mint
  selectProvider: (env: Env, options: EnvelopeProviderOptions) => ESignProvider;
  // The preset: the mint endpoint, the return-URL bridge and the CORS preflight
  createApp: (deps: MintDeps) => HostedFormApp;
}

// The terms callback failed for this request. The mint's own error contract
// (@blinkbitcoin/esign-node) maps an unrecognized throw to a generic 502, so
// the reason is carried out here and createESignApp rewrites the answer with
// it: the terms could not be computed, which is not a signing failure.
const termsFailures = new WeakSet<Request>();

export const isPrefillFailure = (request: Request): boolean => termsFailures.has(request);

// A terms hook that marks its request when it fails, for the rewrite above
const markingFailures =
  <TInput extends { request: Request }, TResult>(compute: (input: TInput) => Promise<TResult>) =>
  async (input: TInput): Promise<TResult> => {
    try {
      return await compute(input);
    } catch (error) {
      termsFailures.add(input.request);
      throw error;
    }
  };

const corsFor = (origins: string[]) => (origins.length > 0 ? { cors: { origins } } : {});

// POST /webform/instance: the signer answers the form's pages before reaching
// the document
const webform: MintMode = {
  name: 'webform',
  clientPrefill: "the client's own prefill",
  selectProvider: hostedFormProviderFromEnv,
  createApp: ({ provider, authenticate, origins, terms, fetch }) =>
    createHostedFormApp({
      provider,
      authenticate,
      health: false,
      ...corsFor(origins),
      ...(terms ? { prefill: markingFailures(createPrefillHook(terms, { fetch })) } : {}),
    }),
};

// The envelope mint over the envelope domain rather than the provider: the
// same request and validation, but the envelope is stored and audited like
// one the GraphQL mutation created (its status follows the webhook,
// getSigningUrl reopens it), and the id answered is the stored one - the id
// the GraphQL API takes, not the provider's.
const storedEnvelopeMint = (
  envelopes: Promise<Pick<EnvelopeService, 'createEnvelope'>>
): EnvelopeMintFn =>
  envelopeMint({
    createEnvelope: async (userId, contractType, recipient, prefill) =>
      (await envelopes).createEnvelope(userId, { contractType, recipient, prefill }),
  });

// Where the envelope mint creates: through the domain when it is on, straight
// at the provider otherwise
const envelopeTarget = (
  provider: ESignProvider,
  envelopes: Promise<Pick<EnvelopeService, 'createEnvelope'>> | undefined
): EnvelopeMintTarget => (envelopes ? { mint: storedEnvelopeMint(envelopes) } : { provider });

// POST /envelope/instance: one envelope from DOCUSIGN_TEMPLATE_ID (several
// ids, in that order), so the signer opens the documents themselves with the
// prefill already on them
const envelope: MintMode = {
  name: 'envelope',
  clientPrefill: "the client's own signer and prefill",
  selectProvider: envelopeProviderFromEnv,
  createApp: ({ provider, authenticate, origins, terms, fetch, envelopes }) =>
    createEnvelopeApp({
      ...envelopeTarget(provider, envelopes),
      authenticate,
      health: false,
      ...corsFor(origins),
      ...(terms ? { terms: markingFailures(createEnvelopePrefillHook(terms, { fetch })) } : {}),
    }),
};

const MINT_MODES: Record<MintModeName, MintMode> = { webform, envelope };

export const isMintModeName = (value: string): value is MintModeName =>
  (MINT_MODE_NAMES as readonly string[]).includes(value);

// The mode this environment asks for, as written. Unset is the Web Form, and
// so is a blank or whitespace-only value, as DATABASE_URL's is: an env file
// with `ESIGN_MINT_MODE=` must not stop a deployment from booting.
export const requestedMintMode = (env: Env): string =>
  (env[ESIGN_MINT_MODE] ?? '').trim() || webform.name;

// The mode this environment runs. A name this service does not know is a
// boot error (config.ts) and the Web Form here, so every other check still
// runs and the guard lists them all at once.
export const mintModeFromEnv = (env: Env): MintMode => {
  const name = requestedMintMode(env);
  return isMintModeName(name) ? MINT_MODES[name] : webform;
};
