// Type definitions for the web ESignature component and the useESignature hook

import type {
  ESignatureError,
  ESignatureLabels,
  ESignatureStatus,
  ESignatureTheme,
  UseESignatureOptions,
} from '@blinkbitcoin/esign-core';
import type React from 'react';

// The contracts shared with React Native come from core; only the embed
// shape, the styles and the hook result are web-specific.
export type {
  ESignatureError,
  ESignatureLabels,
  ESignatureResult,
  ESignatureStatus,
  ESignatureTheme,
  RecipientData,
  UseESignatureOptions,
} from '@blinkbitcoin/esign-core';

/**
 * How to embed the active session. Plain sources get an iframe; DocuSign.js
 * sources mount their own iframe into a container you render with `ref`.
 * Null while no session is active.
 */
export type ESignatureEmbed =
  | { kind: 'iframe'; iframeProps: { src: string; title: string } }
  | { kind: 'mount'; ref: React.RefCallback<HTMLDivElement> }
  | null;

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
  /** Check connectivity, then start the source and enter signing. */
  sign: () => Promise<void>;
  /** Cancel from the idle screen (calls onCancel). */
  cancel: () => void;
  /** Clear the error and return to idle. */
  retry: () => void;
  /** Restart an expired session (falls back to retry for non-restartable sources). */
  restart: () => Promise<void>;
  /** Re-check connectivity from the offline state; returns to idle when online. */
  checkConnection: () => void;
  /** Non-null only while signing - render an iframe or a mount container. */
  embed: ESignatureEmbed;
}

/** Every styled element of the default ESignature UI. */
export type ESignatureStyleKey =
  | 'container'
  | 'iframeContainer'
  | 'iframe'
  | 'title'
  | 'subtitle'
  | 'button'
  | 'cancelButton'
  | 'spinner'
  | 'loadingText'
  | 'successText'
  | 'errorText'
  | 'errorMessage'
  | 'offlineText'
  | 'offlineIcon';

/** Per-element style overrides; applied after the base styles and the theme. */
export type ESignatureStyles = Partial<
  Record<ESignatureStyleKey, React.CSSProperties>
>;

/**
 * Props for the default web ESignature component: the hook options plus the
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
