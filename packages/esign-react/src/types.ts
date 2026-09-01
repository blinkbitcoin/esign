// Type definitions for the web ESignature component
// Named exports only (ESLint enforced)
// The props contract mirrors packages/esign-react-native/src/types.ts.

import type { SigningSession, SigningSource } from '@blinkbitcoin/esign-core';

export type { RecipientData } from '@blinkbitcoin/esign-core';

/**
 * Result returned on successful signing completion. envelopeId is optional
 * because some sources (e.g. a public Web Form URL) don't surface one.
 */
export type ESignatureResult = {
  envelopeId?: string;
  status: 'completed';
};

/**
 * Error information for signing failures
 */
export type ESignatureError = {
  code: string;
  message: string;
};

/**
 * Component status enum - use instead of multiple boolean flags
 */
export type ESignatureStatus =
  | 'idle'
  | 'loading'
  | 'signing'
  | 'success'
  | 'error'
  | 'offline';

/**
 * Props for the web ESignature component.
 *
 * Provider-agnostic: takes a SigningSource (proxy envelope, DocuSign Web Forms,
 * or a public URL). The source may carry an allowedOrigin, which pins the
 * accepted postMessage origin. Construct with createProxySigningSource /
 * createWebFormsSource / createPublicUrlSource.
 */
export interface ESignatureProps {
  /** The signing mode - see the create*SigningSource factories. */
  source: SigningSource;
  /** Idle-screen title and button label (default: "Sign Document"). */
  label?: string;
  onComplete: (result: ESignatureResult) => void;
  onError: (error: ESignatureError) => void;
  onCancel: () => void;
  /** Duration in ms to show success message before calling onComplete (default: 1500) */
  successDelayMs?: number;
  /** @internal Test-only prop to set initial status for testing different states */
  __testInitialStatus?: ESignatureStatus;
  /** @internal Test-only prop to set initial signingUrl for testing the iframe */
  __testSigningUrl?: string;
  /** @internal Test-only prop to set initial session for testing callbacks/restart */
  __testSession?: SigningSession;
}
