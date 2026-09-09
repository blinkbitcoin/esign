// The e-signature provider PORT is the package's; the factory (index.ts)
// selects an adapter and wraps it in tracing. Nothing provider-specific
// leaks past this boundary.

export type { ESignProvider } from '@blinkbitcoin/esign-server';
export { supportsHostedForms, supportsWebForms } from '@blinkbitcoin/esign-server';
