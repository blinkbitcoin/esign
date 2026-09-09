// Deprecated path: the Web Forms minter moved to providers/docusign/webFormsSource
// and the prefill contract to providers/docusign/prefill; the neutral minter is
// ./hostedForm/mint. Kept so the old module path keeps resolving; carries no
// logic of its own.

import { createWebFormsMinter as canonicalCreateWebFormsMinter } from '../providers/docusign/webFormsSource';

import type * as Prefill from '../providers/docusign/prefill';
import type * as WebForms from '../providers/docusign/webFormsSource';

/** @deprecated Import from '@blinkbitcoin/esign-core' (providers/docusign/prefill) */
export type WebFormPhoneNumber = Prefill.WebFormPhoneNumber;
/** @deprecated Import from '@blinkbitcoin/esign-core' (providers/docusign/prefill) */
export type WebFormPrefillValue = Prefill.WebFormPrefillValue;
/** @deprecated Import from '@blinkbitcoin/esign-core' (providers/docusign/prefill) */
export type WebFormPrefill = Prefill.WebFormPrefill;
/** @deprecated Import from '@blinkbitcoin/esign-core' (providers/docusign/webFormsSource) */
export type MintWebFormsInstanceOptions = WebForms.MintWebFormsInstanceOptions;
/** @deprecated Import from '@blinkbitcoin/esign-core' (providers/docusign/webFormsSource) */
export const createWebFormsMinter = canonicalCreateWebFormsMinter;
