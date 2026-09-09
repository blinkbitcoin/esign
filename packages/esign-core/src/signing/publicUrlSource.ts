// Public-URL signing source: a published DocuSign Web Form link, prefilled via
// URL query parameters - the hosted-form public-URL source
// (./hostedForm/publicUrlSource) bound to the DocuSign event interpreter.
// No backend, no credentials. Note prefilled values ride in the URL, so
// avoid it for sensitive data (see docs/security notes).

import { interpretDocuSignEvent } from './events';
import { createHostedFormPublicUrlSource } from './hostedForm/publicUrlSource';

import type { HostedFormPublicUrlSourceOptions } from './hostedForm/publicUrlSource';
import type { SigningSource } from './types';

export type PublicUrlSigningSourceOptions = Omit<
  HostedFormPublicUrlSourceOptions,
  'interpret'
>;

export const createPublicUrlSource = (
  options: PublicUrlSigningSourceOptions,
): SigningSource =>
  createHostedFormPublicUrlSource({
    ...options,
    interpret: interpretDocuSignEvent,
  });
