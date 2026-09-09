// Deprecated path: the Web Forms source moved to providers/docusign/webFormsSource;
// the neutral source it is built on is ./hostedForm/source. Kept so the old
// module path keeps resolving; carries no logic of its own.

import {
  createWebFormsSource as canonicalCreateWebFormsSource,
  resolveCreateInstance as canonicalResolveCreateInstance,
} from '../providers/docusign/webFormsSource';

import type * as WebForms from '../providers/docusign/webFormsSource';

/** @deprecated Import from '@blinkbitcoin/esign-core' (providers/docusign/webFormsSource) */
export type WebFormsInstance = WebForms.WebFormsInstance;
/** @deprecated Import from '@blinkbitcoin/esign-core' (providers/docusign/webFormsSource) */
export type WebFormsCreateInstanceOptions =
  WebForms.WebFormsCreateInstanceOptions;
/** @deprecated Import from '@blinkbitcoin/esign-core' (providers/docusign/webFormsSource) */
export type WebFormsMintOptions = WebForms.WebFormsMintOptions;
/** @deprecated Import from '@blinkbitcoin/esign-core' (providers/docusign/webFormsSource) */
export type WebFormsSigningSourceOptions =
  WebForms.WebFormsSigningSourceOptions;
/** @deprecated Import from '@blinkbitcoin/esign-core' (providers/docusign/webFormsSource) */
export const resolveCreateInstance = canonicalResolveCreateInstance;
/** @deprecated Import from '@blinkbitcoin/esign-core' (providers/docusign/webFormsSource) */
export const createWebFormsSource = canonicalCreateWebFormsSource;
