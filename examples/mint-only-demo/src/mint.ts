// The one call to @blinkbitcoin/esign-node this host makes: the hosted-form
// mint of the provider ESIGN_PROVIDER selects. `hostedFormProviderFromEnv`
// is the package's own preset over `defaultRegistry` - DocuSign unless
// ESIGN_PROVIDER=mock, with everything a mint needs (the JWT grant plus
// webFormId/returnUrl) required at selection time, so a missing credential
// fails at startup, not on the first mutation. With ESIGN_PROVIDER=mock the
// mock provider mints a URL onto the full-service demo's mock Web Forms
// page, so the mutation can be exercised with no DocuSign account.

import {
  type HostedFormMint,
  hostedFormMint,
  hostedFormProviderFromEnv,
} from '@blinkbitcoin/esign-node';

export const createMint = (
  env: NodeJS.ProcessEnv = process.env,
): HostedFormMint =>
  // hostedFormProviderFromEnv already refuses (throws) a provider without
  // the hosted-form capability, so the mint below is never undefined.
  hostedFormMint(hostedFormProviderFromEnv(env))!;
