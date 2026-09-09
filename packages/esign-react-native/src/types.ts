// Type definitions for the ESignature component and the useESignature hook
// Named exports only (ESLint enforced)

import type {
  ESignatureLabels as CoreLabels,
  ESignatureError,
  ESignatureStatus,
  ESignatureTheme,
  UseESignatureOptions,
} from '@blinkbitcoin/esign-core/webform';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import type { WebViewProps } from 'react-native-webview';

// The contracts shared with the web package come from core; only the
// WebView props, the styles and the hook result are React Native-specific.
export type {
  ESignatureError,
  ESignatureResult,
  ESignatureStatus,
  ESignatureTheme,
  RecipientData,
  UseESignatureOptions,
} from '@blinkbitcoin/esign-core/webform';

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

/** Copy overrides for the default ESignature UI (the shared keys plus the connectivity re-check). */
export interface ESignatureLabels extends CoreLabels {
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
