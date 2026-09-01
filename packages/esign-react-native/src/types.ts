// Type definitions for ESignature component
// Named exports only (ESLint enforced)

import type {
  SigningSession,
  SigningSource,
} from '@blinkbitcoin/esignature-core/webform';

export type { RecipientData } from '@blinkbitcoin/esignature-core/webform';

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
 * Props for ESignature component.
 *
 * The component is provider-agnostic: it takes a SigningSource (proxy envelope,
 * DocuSign Web Forms, or a public URL) and drives the embedded signing flow.
 * Construct a source with createProxySigningSource / createWebFormsSource /
 * createPublicUrlSource.
 */
export interface ESignatureProps {
  /** The signing mode - see createProxySigningSource / createWebFormsSource / createPublicUrlSource. */
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
  /** @internal Test-only prop to set initial signingUrl for testing WebView */
  __testSigningUrl?: string;
  /** @internal Test-only prop to set initial session for testing callbacks/restart */
  __testSession?: SigningSession;
}
