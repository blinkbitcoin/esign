// The DocuSign provider, web side: the DocuSign.js source (SDK-mounted real
// Web Forms). The URL-embedded sources and the interpreter come from core's
// providers/docusign, re-exported by @blinkbitcoin/esign-core/docusign.

export type {
  DocuSignSdk,
  DocuSignSigning,
  DocuSignWebFormsCreateInstanceOptions,
  DocuSignWebFormsMintOptions,
  DocuSignWebFormsSourceOptions,
  LoadDocuSign,
  MountableSigningSource,
} from './webFormsSource';
export { createDocuSignWebFormsSource, isMountable } from './webFormsSource';
