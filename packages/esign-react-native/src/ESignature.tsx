// ESignature component - the default UI over the useESignature hook.
// Provider-agnostic: it embeds whatever URL its SigningSource resolves in a
// WebView. The state machine (offline handling, restart, success delay) lives
// in useESignature; this file owns only the built-in screens, which a host
// can recolor (`theme`), restyle (`styles`), and relabel (`labels`) - or
// replace entirely by using the hook directly.

import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';

import { useESignature } from './useESignature';
import { resolveLabels, resolveStyles } from './theme';
import type { ESignatureProps } from './types';

// Re-exported for backwards-compatible imports (Apollo-free).
// getApolloErrorCode is re-exported from index.ts, NOT here - this file must
// stay reachable from the Apollo-free ./webform entry.
export { getErrorMessage } from '@blinkbitcoin/esign-core/webform';

/**
 * ESignature component for document signing flow.
 * Drives a SigningSource (see createProxySigningSource / createWebFormsSource /
 * createPublicUrlSource) and a WebView for the provider's embedded session.
 */
export const ESignature: React.FC<ESignatureProps> = ({
  label = 'Sign Document',
  theme,
  styles,
  labels,
  ...options
}) => {
  const {
    status,
    error,
    isSessionExpired,
    isCheckingConnection,
    sign,
    cancel,
    retry,
    restart,
    checkConnection,
    webViewProps,
  } = useESignature(options);

  const s = useMemo(() => resolveStyles(theme, styles), [theme, styles]);
  const t = useMemo(() => resolveLabels(label, labels), [label, labels]);

  // Render based on status
  switch (status) {
    case 'idle':
      return (
        <View style={s.container}>
          <Text style={s.title}>{t.title}</Text>
          <Text style={s.subtitle}>{t.subtitle}</Text>
          <TouchableOpacity
            style={s.button}
            onPress={sign}
            testID="sign-document-button"
            accessibilityRole="button"
            accessibilityLabel={t.sign}
          >
            <Text style={s.buttonText}>{t.sign}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.cancelButton}
            onPress={cancel}
            testID="cancel-button"
            accessibilityRole="button"
            accessibilityLabel="Cancel signing"
          >
            <Text style={s.cancelButtonText}>{t.cancel}</Text>
          </TouchableOpacity>
        </View>
      );

    case 'loading':
      return (
        <View style={s.container}>
          <ActivityIndicator
            size="large"
            color={theme?.primaryColor}
            testID="loading-indicator"
            accessibilityLabel="Loading, please wait"
          />
          <Text style={s.loadingText}>{t.loading}</Text>
        </View>
      );

    case 'signing':
      if (webViewProps) {
        return (
          <View style={s.webviewContainer}>
            <WebView
              {...webViewProps}
              testID="signing-webview"
              style={s.webview}
            />
          </View>
        );
      }
      // Fallback if no signingUrl (shouldn't happen in normal flow)
      return (
        <View style={s.container}>
          <Text style={s.title}>{t.signingTitle}</Text>
          <Text style={s.subtitle}>{t.signingSubtitle}</Text>
        </View>
      );

    case 'success':
      return (
        <View style={s.container} testID="success-screen">
          <Text
            style={s.successText}
            testID="success-text"
            accessibilityLabel="Signing completed successfully"
          >
            {t.success}
          </Text>
        </View>
      );

    case 'error':
      return (
        <View style={s.container}>
          <Text
            style={s.errorText}
            testID="error-text"
            accessibilityLabel="An error occurred"
          >
            {t.errorTitle}
          </Text>
          <Text style={s.errorMessage} testID="error-message">
            {error?.message || t.errorFallback}
          </Text>
          <TouchableOpacity
            style={s.button}
            onPress={isSessionExpired ? restart : retry}
            testID={isSessionExpired ? 'restart-button' : 'retry-button'}
            accessibilityRole="button"
            accessibilityLabel={
              isSessionExpired ? 'Restart signing' : 'Try again'
            }
          >
            <Text style={s.buttonText}>
              {isSessionExpired ? t.restart : t.retry}
            </Text>
          </TouchableOpacity>
        </View>
      );

    case 'offline':
      return (
        <View style={s.container}>
          <Text style={s.offlineIcon} accessibilityLabel="No connection">
            ⚠
          </Text>
          <Text
            style={s.offlineText}
            testID="offline-text"
            accessibilityLabel="Connection required to sign documents"
          >
            {t.offline}
          </Text>
          <TouchableOpacity
            style={[s.button, isCheckingConnection && s.buttonDisabled]}
            onPress={checkConnection}
            disabled={isCheckingConnection}
            testID="check-connection-button"
            accessibilityRole="button"
            accessibilityLabel="Check connection"
          >
            <Text style={s.buttonText}>
              {isCheckingConnection ? t.checking : t.checkConnection}
            </Text>
          </TouchableOpacity>
        </View>
      );
  }
};
