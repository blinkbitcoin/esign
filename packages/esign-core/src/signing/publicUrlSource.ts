// Deprecated path: the DocuSign-bound public-URL source moved to
// providers/docusign/webFormsSource; the neutral one is ./hostedForm/publicUrlSource.
// Kept so the old module path keeps resolving; carries no logic of its own.

import { createPublicUrlSource as canonicalCreatePublicUrlSource } from '../providers/docusign/webFormsSource';

import type * as WebForms from '../providers/docusign/webFormsSource';

/** @deprecated Import from '@blinkbitcoin/esign-core' (providers/docusign/webFormsSource) */
export type PublicUrlSigningSourceOptions =
  WebForms.PublicUrlSigningSourceOptions;
/** @deprecated Import from '@blinkbitcoin/esign-core' (providers/docusign/webFormsSource) */
export const createPublicUrlSource = canonicalCreatePublicUrlSource;
