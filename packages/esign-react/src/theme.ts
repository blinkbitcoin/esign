// Look of the default web ESignature UI: base styles, default copy, and the
// resolvers that layer a host's theme / styles / labels on top.
// Precedence: base style < theme-derived color < styles[key].
// Mirrors the RN component's StyleSheet (WCAG AA colors).

import type React from 'react';

import type {
  ESignatureLabels,
  ESignatureStyleKey,
  ESignatureStyles,
  ESignatureTheme,
} from './types';

export const baseStyles: Record<ESignatureStyleKey, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    fontFamily: 'system-ui, sans-serif',
  },
  iframeContainer: {
    width: '100%',
    height: '100%',
    minHeight: 480,
  },
  iframe: {
    width: '100%',
    height: '100%',
    minHeight: 480,
    border: 'none',
  },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 10 },
  subtitle: { fontSize: 16, color: '#666', marginBottom: 5 },
  button: {
    backgroundColor: '#007AFF',
    color: '#fff',
    fontSize: 16,
    fontWeight: 600,
    padding: '12px 30px',
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    marginBottom: 10,
  },
  cancelButton: {
    background: 'none',
    color: '#007AFF',
    fontSize: 16,
    padding: '12px 30px',
    border: 'none',
    cursor: 'pointer',
  },
  spinner: {
    width: 32,
    height: 32,
    border: '4px solid #ddd',
    borderTopColor: '#007AFF',
    borderRadius: '50%',
  },
  loadingText: { marginTop: 10, fontSize: 16, color: '#666' },
  successText: { fontSize: 24, color: '#1E7E34', fontWeight: 'bold' },
  errorText: {
    fontSize: 20,
    color: '#C82333',
    fontWeight: 'bold',
    marginBottom: 10,
  },
  errorMessage: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
  },
  offlineText: {
    fontSize: 18,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
  },
  offlineIcon: { fontSize: 48, marginBottom: 16, color: '#F0AD4E' },
};

/** Copy of the built-in screens; `title` and `sign` come from `label`. */
export const DEFAULT_LABELS: Required<
  Omit<ESignatureLabels, 'title' | 'sign'>
> = {
  subtitle: 'Review and sign your document',
  cancel: 'Cancel',
  loading: 'Preparing document...',
  signingTitle: 'Signing in Progress',
  signingSubtitle: 'Please complete signing in the embedded page',
  success: '✓ Signing Complete!',
  errorTitle: 'Error',
  errorFallback: 'An error occurred',
  retry: 'Try Again',
  restart: 'Restart',
  offline: 'Connection required to sign documents',
  checkConnection: 'Check Connection',
};

export type ResolvedLabels = Required<ESignatureLabels>;

/** Defaults, then `label` for title/sign, then any explicit overrides. */
export const resolveLabels = (
  label: string,
  labels?: ESignatureLabels,
): ResolvedLabels => {
  const resolved: ResolvedLabels = {
    ...DEFAULT_LABELS,
    title: label,
    sign: label,
  };
  for (const key of Object.keys(labels ?? {}) as (keyof ESignatureLabels)[]) {
    const value = labels?.[key];
    if (value != null) {
      resolved[key] = value;
    }
  }
  return resolved;
};

export type ResolvedStyles = Record<ESignatureStyleKey, React.CSSProperties>;

const color = (value?: string): React.CSSProperties | undefined =>
  value != null ? { color: value } : undefined;

/** Base styles, then theme colors, then per-element overrides. */
export const resolveStyles = (
  theme?: ESignatureTheme,
  styles?: ESignatureStyles,
): ResolvedStyles => ({
  container: { ...baseStyles.container, ...styles?.container },
  iframeContainer: {
    ...baseStyles.iframeContainer,
    ...styles?.iframeContainer,
  },
  iframe: { ...baseStyles.iframe, ...styles?.iframe },
  title: { ...baseStyles.title, ...styles?.title },
  subtitle: {
    ...baseStyles.subtitle,
    ...color(theme?.mutedTextColor),
    ...styles?.subtitle,
  },
  button: {
    ...baseStyles.button,
    ...(theme?.primaryColor != null && {
      backgroundColor: theme.primaryColor,
    }),
    ...color(theme?.primaryTextColor),
    ...styles?.button,
  },
  cancelButton: {
    ...baseStyles.cancelButton,
    ...color(theme?.primaryColor),
    ...styles?.cancelButton,
  },
  spinner: {
    ...baseStyles.spinner,
    ...(theme?.primaryColor != null && {
      borderTopColor: theme.primaryColor,
    }),
    ...styles?.spinner,
  },
  loadingText: {
    ...baseStyles.loadingText,
    ...color(theme?.mutedTextColor),
    ...styles?.loadingText,
  },
  successText: {
    ...baseStyles.successText,
    ...color(theme?.successColor),
    ...styles?.successText,
  },
  errorText: {
    ...baseStyles.errorText,
    ...color(theme?.errorColor),
    ...styles?.errorText,
  },
  errorMessage: {
    ...baseStyles.errorMessage,
    ...color(theme?.mutedTextColor),
    ...styles?.errorMessage,
  },
  offlineText: {
    ...baseStyles.offlineText,
    ...color(theme?.mutedTextColor),
    ...styles?.offlineText,
  },
  offlineIcon: {
    ...baseStyles.offlineIcon,
    ...color(theme?.warningColor),
    ...styles?.offlineIcon,
  },
});
