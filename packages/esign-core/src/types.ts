// Shared domain types for the e-signature core (platform-agnostic).

/** Recipient data for a signing request. */
export type RecipientData = {
  name: string;
  email: string;
};

import type { ESignatureStatus, SigningCallbacks } from './signing/machine';
import type { SigningSession, SigningSource } from './signing/types';

/**
 * Colors applied on top of the default ESignature look. Every key is
 * optional; unset keys keep the built-in value.
 */
export interface ESignatureTheme {
  /** Primary button background, cancel text, and spinner (default #007AFF). */
  primaryColor?: string;
  /** Primary button text (default #fff). */
  primaryTextColor?: string;
  /** Subtitle, loading, error-detail, and offline copy (default #666). */
  mutedTextColor?: string;
  /** Success message (default #1E7E34). */
  successColor?: string;
  /** Error title (default #C82333). */
  errorColor?: string;
  /** Offline warning icon (default #F0AD4E). */
  warningColor?: string;
}

/**
 * Options for the headless useESignature hook, identical on every platform.
 *
 * Provider-agnostic: takes a SigningSource (proxy envelope, DocuSign Web
 * Forms, or a public URL). Construct a source with createProxySigningSource /
 * createWebFormsSource / createPublicUrlSource (web: createDocuSignWebFormsSource).
 */
export interface UseESignatureOptions extends SigningCallbacks {
  /** The signing mode - see the create*SigningSource factories. */
  source: SigningSource;
  /** Duration in ms to hold the success state before calling onComplete (default: 1500) */
  successDelayMs?: number;
  /** @internal Test-only option to seed the initial status */
  __testInitialStatus?: ESignatureStatus;
  /** @internal Test-only option to seed the initial signingUrl */
  __testSigningUrl?: string;
  /** @internal Test-only option to seed the initial session for callbacks/restart */
  __testSession?: SigningSession;
}
