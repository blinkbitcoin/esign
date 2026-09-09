// The DocuSign provider, client side: the event interpreter, the Web Forms
// prefill contract and the Web Forms sources. Everything here is DocuSign's;
// the neutral pieces they are built on live in signing/ (which never imports
// from providers/ - guard-tested).

export { interpretDocuSignEvent } from './events';
export type {
  WebFormPhoneNumber,
  WebFormPrefill,
  WebFormPrefillValue,
} from './prefill';
export {
  createPublicUrlSource,
  createWebFormsMinter,
  createWebFormsSource,
  resolveCreateInstance,
} from './webFormsSource';
export type {
  MintWebFormsInstanceOptions,
  PublicUrlSigningSourceOptions,
  WebFormsCreateInstanceOptions,
  WebFormsInstance,
  WebFormsMintOptions,
  WebFormsSigningSourceOptions,
} from './webFormsSource';
