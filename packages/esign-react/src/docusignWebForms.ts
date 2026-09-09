// Deprecated path: the DocuSign.js source moved to providers/docusign/webFormsSource.
// Kept so the old module path keeps resolving; carries no logic of its own.

import {
  createDocuSignWebFormsSource as canonicalCreateDocuSignWebFormsSource,
  isMountable as canonicalIsMountable,
} from './providers/docusign/webFormsSource';

import type * as DocuSign from './providers/docusign/webFormsSource';

/** @deprecated Import from '@blinkbitcoin/esign-react/docusign' */
export type DocuSignSigning = DocuSign.DocuSignSigning;
/** @deprecated Import from '@blinkbitcoin/esign-react/docusign' */
export type DocuSignSdk = DocuSign.DocuSignSdk;
/** @deprecated Import from '@blinkbitcoin/esign-react/docusign' */
export type LoadDocuSign = DocuSign.LoadDocuSign;
/** @deprecated Import from '@blinkbitcoin/esign-react/docusign' */
export type MountableSigningSource = DocuSign.MountableSigningSource;
/** @deprecated Import from '@blinkbitcoin/esign-react/docusign' */
export type DocuSignWebFormsCreateInstanceOptions =
  DocuSign.DocuSignWebFormsCreateInstanceOptions;
/** @deprecated Import from '@blinkbitcoin/esign-react/docusign' */
export type DocuSignWebFormsMintOptions = DocuSign.DocuSignWebFormsMintOptions;
/** @deprecated Import from '@blinkbitcoin/esign-react/docusign' */
export type DocuSignWebFormsSourceOptions =
  DocuSign.DocuSignWebFormsSourceOptions;
/** @deprecated Import from '@blinkbitcoin/esign-react/docusign' */
export const isMountable = canonicalIsMountable;
/** @deprecated Import from '@blinkbitcoin/esign-react/docusign' */
export const createDocuSignWebFormsSource =
  canonicalCreateDocuSignWebFormsSource;
