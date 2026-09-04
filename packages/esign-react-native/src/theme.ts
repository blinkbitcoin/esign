// Look of the default ESignature UI: base styles, default copy, and the
// resolvers that layer a host's theme / styles / labels on top.
// Precedence: base style < theme-derived color < styles[key].

import { StyleSheet } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';

import type {
  ESignatureLabels,
  ESignatureStyleKey,
  ESignatureStyles,
  ESignatureTheme,
} from './types';

export const baseStyles = StyleSheet.create({
  container: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webviewContainer: {
    flex: 1,
    width: '100%',
  },
  webview: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 5,
  },
  button: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  cancelButton: {
    paddingHorizontal: 30,
    paddingVertical: 12,
  },
  cancelButtonText: {
    color: '#007AFF',
    fontSize: 16,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  successText: {
    fontSize: 24,
    color: '#1E7E34', // Darker green for WCAG AA contrast (4.5:1)
    fontWeight: 'bold',
  },
  errorText: {
    fontSize: 20,
    color: '#C82333', // Darker red for WCAG AA contrast (4.5:1)
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
  offlineIcon: {
    fontSize: 48,
    marginBottom: 16,
    color: '#F0AD4E', // Warning amber color
  },
});

/** Copy of the built-in screens; `title` and `sign` come from `label`. */
export const DEFAULT_LABELS: Required<
  Omit<ESignatureLabels, 'title' | 'sign'>
> = {
  subtitle: 'Review and sign your document',
  cancel: 'Cancel',
  loading: 'Preparing document...',
  signingTitle: 'Signing in Progress',
  signingSubtitle: 'Please complete signing in the browser',
  success: '✓ Signing Complete!',
  errorTitle: 'Error',
  errorFallback: 'An error occurred',
  retry: 'Try Again',
  restart: 'Restart',
  offline: 'Connection required to sign documents',
  checkConnection: 'Check Connection',
  checking: 'Checking...',
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

export type ResolvedStyles = Record<
  ESignatureStyleKey,
  StyleProp<ViewStyle | TextStyle>
>;

const color = (value?: string): TextStyle | undefined =>
  value != null ? { color: value } : undefined;
const background = (value?: string): ViewStyle | undefined =>
  value != null ? { backgroundColor: value } : undefined;

/** Base styles, then theme colors, then per-element overrides. */
export const resolveStyles = (
  theme?: ESignatureTheme,
  styles?: ESignatureStyles,
): ResolvedStyles => ({
  container: [baseStyles.container, styles?.container],
  webviewContainer: [baseStyles.webviewContainer, styles?.webviewContainer],
  webview: [baseStyles.webview, styles?.webview],
  title: [baseStyles.title, styles?.title],
  subtitle: [
    baseStyles.subtitle,
    color(theme?.mutedTextColor),
    styles?.subtitle,
  ],
  button: [baseStyles.button, background(theme?.primaryColor), styles?.button],
  buttonText: [
    baseStyles.buttonText,
    color(theme?.primaryTextColor),
    styles?.buttonText,
  ],
  buttonDisabled: [baseStyles.buttonDisabled, styles?.buttonDisabled],
  cancelButton: [baseStyles.cancelButton, styles?.cancelButton],
  cancelButtonText: [
    baseStyles.cancelButtonText,
    color(theme?.primaryColor),
    styles?.cancelButtonText,
  ],
  loadingText: [
    baseStyles.loadingText,
    color(theme?.mutedTextColor),
    styles?.loadingText,
  ],
  successText: [
    baseStyles.successText,
    color(theme?.successColor),
    styles?.successText,
  ],
  errorText: [
    baseStyles.errorText,
    color(theme?.errorColor),
    styles?.errorText,
  ],
  errorMessage: [
    baseStyles.errorMessage,
    color(theme?.mutedTextColor),
    styles?.errorMessage,
  ],
  offlineText: [
    baseStyles.offlineText,
    color(theme?.mutedTextColor),
    styles?.offlineText,
  ],
  offlineIcon: [
    baseStyles.offlineIcon,
    color(theme?.warningColor),
    styles?.offlineIcon,
  ],
});
