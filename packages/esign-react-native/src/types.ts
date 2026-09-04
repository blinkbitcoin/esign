// Type definitions for the ESignature component and the useESignature hook
// Named exports only (ESLint enforced)

import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import type { WebViewProps } from 'react-native-webview';
import type {
  SigningSession,
  SigningSource,
} from '@blinkbitcoin/esign-core/webform';

export type { RecipientData } from '@blinkbitcoin/esign-core/webform';

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
 * Signing-flow status - use instead of multiple boolean flags
 */
export type ESignatureStatus =
  | 'idle'
  | 'loading'
  | 'signing'
  | 'success'
  | 'error'
  | 'offline';

/**
 * Options for the headless useESignature hook.
 *
 * Provider-agnostic: takes a SigningSource (proxy envelope, DocuSign Web
 * Forms, or a public URL). Construct a source with createProxySigningSource /
 * createWebFormsSource / createPublicUrlSource.
 */
export interface UseESignatureOptions {
  /** The signing mode - see createProxySigningSource / createWebFormsSource / createPublicUrlSource. */
  source: SigningSource;
  onComplete: (result: ESignatureResult) => void;
  onError: (error: ESignatureError) => void;
  onCancel: () => void;
  /** Duration in ms to hold the success state before calling onComplete (default: 1500) */
  successDelayMs?: number;
  /** @internal Test-only option to seed the initial status */
  __testInitialStatus?: ESignatureStatus;
  /** @internal Test-only option to seed the initial signingUrl */
  __testSigningUrl?: string;
  /** @internal Test-only option to seed the initial session for callbacks/restart */
  __testSession?: SigningSession;
}

/**
 * The WebView props the hook manages while a session is active. Spread them
 * onto a react-native-webview `WebView`; layout (`style`, `testID`) is yours.
 */
export type ESignatureWebViewProps = Pick<
  WebViewProps,
  | 'source'
  | 'onMessage'
  | 'javaScriptEnabled'
  | 'domStorageEnabled'
  | 'startInLoadingState'
>;

/**
 * State and actions returned by useESignature. Everything the default
 * ESignature UI renders comes from here; a host app can render its own.
 */
export interface UseESignatureResult {
  status: ESignatureStatus;
  error: ESignatureError | null;
  signingUrl: string | null;
  /** True when the current error is SESSION_EXPIRED (offer restart, not retry). */
  isSessionExpired: boolean;
  /** True while a connectivity re-check from the offline state is in flight. */
  isCheckingConnection: boolean;
  /** Check connectivity, then start the source and enter signing. */
  sign: () => Promise<void>;
  /** Cancel from the idle screen (calls onCancel). */
  cancel: () => void;
  /** Clear the error and return to idle. */
  retry: () => void;
  /** Restart an expired session (falls back to retry for non-restartable sources). */
  restart: () => Promise<void>;
  /** Re-check connectivity from the offline state; returns to idle when online. */
  checkConnection: () => Promise<void>;
  /** Non-null only while signing with a URL - spread onto a WebView. */
  webViewProps: ESignatureWebViewProps | null;
}

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

/** Every styled element of the default ESignature UI. */
export type ESignatureStyleKey =
  | 'container'
  | 'webviewContainer'
  | 'webview'
  | 'title'
  | 'subtitle'
  | 'button'
  | 'buttonText'
  | 'buttonDisabled'
  | 'cancelButton'
  | 'cancelButtonText'
  | 'loadingText'
  | 'successText'
  | 'errorText'
  | 'errorMessage'
  | 'offlineText'
  | 'offlineIcon';

/** Per-element style overrides; applied after the base styles and the theme. */
export type ESignatureStyles = Partial<
  Record<ESignatureStyleKey, StyleProp<ViewStyle | TextStyle>>
>;

/** Copy overrides for the default ESignature UI. */
export interface ESignatureLabels {
  /** Idle-screen title (defaults to `label`). */
  title?: string;
  /** Idle-screen subtitle. */
  subtitle?: string;
  /** Primary sign button (defaults to `label`). */
  sign?: string;
  cancel?: string;
  loading?: string;
  signingTitle?: string;
  signingSubtitle?: string;
  success?: string;
  errorTitle?: string;
  /** Shown when an error carries no message. */
  errorFallback?: string;
  retry?: string;
  restart?: string;
  offline?: string;
  checkConnection?: string;
  /** Check-connection button while the re-check is in flight. */
  checking?: string;
}

/**
 * Props for the default ESignature component: the hook options plus the
 * look of the built-in screens.
 */
export interface ESignatureProps extends UseESignatureOptions {
  /** Idle-screen title and button label (default: "Sign Document"). */
  label?: string;
  /** Color overrides for the built-in screens. */
  theme?: ESignatureTheme;
  /** Per-element style overrides (win over `theme`). */
  styles?: ESignatureStyles;
  /** Copy overrides for the built-in screens. */
  labels?: ESignatureLabels;
}
