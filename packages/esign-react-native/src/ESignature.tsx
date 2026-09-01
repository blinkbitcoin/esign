// ESignature component - WebView integrated e-signature signing flow.
// Provider-agnostic: it embeds whatever URL its SigningSource resolves and
// normalizes the source's events. Acquisition + event protocol live in the
// source (proxy / Web Forms / public URL); this component owns the state
// machine, the WebView embedding, offline handling, and the UX.

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import NetInfo from '@react-native-community/netinfo';

import {
  getErrorMessage,
  isRestartable,
} from '@blinkbitcoin/esign-core/webform';
import type {
  SigningSession,
  SigningSourceError,
} from '@blinkbitcoin/esign-core/webform';
import type {
  ESignatureProps,
  ESignatureStatus,
  ESignatureError,
} from './types';

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
  source,
  label = 'Sign Document',
  onComplete,
  onError,
  onCancel,
  successDelayMs = 1500,
  __testInitialStatus,
  __testSigningUrl,
  __testSession,
}) => {
  const [status, setStatus] = useState<ESignatureStatus>(
    __testInitialStatus ?? 'idle',
  );
  const [error, setError] = useState<ESignatureError | null>(null);
  const [signingUrl, setSigningUrl] = useState<string | null>(
    __testSigningUrl ?? __testSession?.url ?? null,
  );
  // The active session (URL, envelopeId, allowedOrigin) never drives rendering,
  // so it lives in a ref - also avoids stale closures in the message handler
  // and is preserved across session-expiry for restart.
  const sessionRef = useRef<SigningSession | null>(
    __testSession ?? (__testSigningUrl ? { url: __testSigningUrl } : null),
  );
  // Track success timeout for cleanup on unmount
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lets async work detect unmount (in-flight source.start(), connectivity)
  const mountedRef = useRef(true);

  // Cleanup on unmount: cancel the success timeout, mark unmounted
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  // Acquire a session (start or restart) and enter the signing state, mapping
  // any SigningSourceError to a user-facing error state.
  const beginSigning = useCallback(
    async (acquire: () => Promise<SigningSession>) => {
      setStatus('loading');
      try {
        const session = await acquire();
        // The acquire call can outlive the component (user navigated away
        // mid-loading) - a late result must not update state or fire callbacks
        if (!mountedRef.current) {
          return;
        }
        sessionRef.current = session;
        setSigningUrl(session.url);
        setStatus('signing');
      } catch (e) {
        if (!mountedRef.current) {
          return;
        }
        const sourceError = e as SigningSourceError;
        const code = sourceError?.code ?? 'UNKNOWN_ERROR';
        const message = getErrorMessage(code, sourceError?.message);
        setError({ code, message });
        setStatus('error');
        onError({ code, message });
      }
    },
    [onError],
  );

  // Handle signing-session postMessage events from the WebView
  const handleWebViewMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let raw: unknown;
      try {
        raw = JSON.parse(event.nativeEvent.data);
      } catch (e) {
        /* istanbul ignore else -- __DEV__ is hardcoded true by the RN Jest preset; the false branch is a compile-time-only path Metro strips in production */
        if (__DEV__) {
          console.error('WebView message parse error:', e);
        }
        return;
      }

      const signingEvent = source.interpret(raw);
      if (!signingEvent) {
        /* istanbul ignore else -- __DEV__ is hardcoded true by the RN Jest preset; the false branch is a compile-time-only path Metro strips in production */
        if (__DEV__) {
          console.warn('Unknown signing WebView event:', raw);
        }
        return;
      }

      switch (signingEvent.type) {
        case 'complete': {
          setStatus('success');
          // Show success briefly before calling onComplete (configurable)
          successTimeoutRef.current = setTimeout(() => {
            onComplete({
              // Prefer an id from the event; fall back to the session's
              envelopeId:
                signingEvent.envelopeId ?? sessionRef.current?.envelopeId,
              status: 'completed',
            });
            setSigningUrl(null);
          }, successDelayMs);
          break;
        }

        case 'cancel':
        case 'decline':
          setStatus('idle');
          onCancel();
          setSigningUrl(null);
          sessionRef.current = null;
          break;

        case 'sessionExpired': {
          const message = getErrorMessage('SESSION_EXPIRED');
          setStatus('error');
          setError({ code: 'SESSION_EXPIRED', message });
          onError({ code: 'SESSION_EXPIRED', message });
          // Clear signingUrl but PRESERVE sessionRef for restart capability
          setSigningUrl(null);
          break;
        }

        case 'error': {
          const code = signingEvent.code ?? 'SIGNING_ERROR';
          const message = signingEvent.message ?? getErrorMessage(code);
          setStatus('error');
          setError({ code, message });
          onError({ code, message });
          setSigningUrl(null);
          sessionRef.current = null;
          break;
        }
      }
    },
    [source, onComplete, onCancel, onError, successDelayMs],
  );

  // Check network connectivity
  const checkConnectivity = async (): Promise<boolean> => {
    const state = await NetInfo.fetch();
    return state.isConnected === true && state.isInternetReachable !== false;
  };

  const handleSign = async () => {
    // Check connectivity BEFORE any API call
    const isOnline = await checkConnectivity();
    if (!isOnline) {
      setStatus('offline');
      // Do NOT call onError - offline is an expected state, not an error
      return;
    }
    await beginSigning(() => source.start());
  };

  // Handle connectivity check from offline state
  // Track if we're actively checking connection
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);

  const handleCheckConnection = async () => {
    setIsCheckingConnection(true);
    const isOnline = await checkConnectivity();
    setIsCheckingConnection(false);
    if (isOnline) {
      // Now online - transition to idle so user can tap Sign again
      setStatus('idle');
    }
    // If still offline, remain in offline status (user can retry)
  };

  const handleCancel = () => {
    onCancel();
  };

  const handleRetry = () => {
    setError(null);
    setSigningUrl(null);
    sessionRef.current = null;
    setStatus('idle');
  };

  // Handle restart for session expiration. Only sources that
  // support restart AND a preserved session can restart; otherwise fall back
  // to a full retry.
  const handleRestart = () => {
    // Non-restartable sources (public URL / Web Forms) fall back to a fresh start
    if (!isRestartable(source)) {
      handleRetry();
      return;
    }
    const restartable = source;
    const session = sessionRef.current;
    /* istanbul ignore next -- the restart button is only shown after a
       SESSION_EXPIRED event, which preserves sessionRef; this guard is defensive */
    if (!session) {
      handleRetry();
      return;
    }
    setError(null);
    beginSigning(() => restartable.restart(session));
  };

  // Render based on status
  switch (status) {
    case 'idle':
      return (
        <View style={styles.container}>
          <Text style={styles.title}>{label}</Text>
          <Text style={styles.subtitle}>Review and sign your document</Text>
          <TouchableOpacity
            style={styles.button}
            onPress={handleSign}
            testID="sign-document-button"
            accessibilityRole="button"
            accessibilityLabel={label}
          >
            <Text style={styles.buttonText}>{label}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={handleCancel}
            testID="cancel-button"
            accessibilityRole="button"
            accessibilityLabel="Cancel signing"
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      );

    case 'loading':
      return (
        <View style={styles.container}>
          <ActivityIndicator
            size="large"
            testID="loading-indicator"
            accessibilityLabel="Loading, please wait"
          />
          <Text style={styles.loadingText}>Preparing document...</Text>
        </View>
      );

    case 'signing':
      if (signingUrl) {
        return (
          <View style={styles.webviewContainer}>
            <WebView
              testID="signing-webview"
              source={{ uri: signingUrl }}
              onMessage={handleWebViewMessage}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              startInLoadingState={true}
              style={styles.webview}
            />
          </View>
        );
      }
      // Fallback if no signingUrl (shouldn't happen in normal flow)
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Signing in Progress</Text>
          <Text style={styles.subtitle}>
            Please complete signing in the browser
          </Text>
        </View>
      );

    case 'success':
      return (
        <View style={styles.container} testID="success-screen">
          <Text
            style={styles.successText}
            testID="success-text"
            accessibilityLabel="Signing completed successfully"
          >
            ✓ Signing Complete!
          </Text>
        </View>
      );

    case 'error': {
      const isSessionExpired = error?.code === 'SESSION_EXPIRED';
      return (
        <View style={styles.container}>
          <Text
            style={styles.errorText}
            testID="error-text"
            accessibilityLabel="An error occurred"
          >
            Error
          </Text>
          <Text style={styles.errorMessage} testID="error-message">
            {error?.message || 'An error occurred'}
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={isSessionExpired ? handleRestart : handleRetry}
            testID={isSessionExpired ? 'restart-button' : 'retry-button'}
            accessibilityRole="button"
            accessibilityLabel={
              isSessionExpired ? 'Restart signing' : 'Try again'
            }
          >
            <Text style={styles.buttonText}>
              {isSessionExpired ? 'Restart' : 'Try Again'}
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    case 'offline':
      return (
        <View style={styles.container}>
          <Text style={styles.offlineIcon} accessibilityLabel="No connection">
            ⚠
          </Text>
          <Text
            style={styles.offlineText}
            testID="offline-text"
            accessibilityLabel="Connection required to sign documents"
          >
            Connection required to sign documents
          </Text>
          <TouchableOpacity
            style={[
              styles.button,
              isCheckingConnection && styles.buttonDisabled,
            ]}
            onPress={handleCheckConnection}
            disabled={isCheckingConnection}
            testID="check-connection-button"
            accessibilityRole="button"
            accessibilityLabel="Check connection"
          >
            <Text style={styles.buttonText}>
              {isCheckingConnection ? 'Checking...' : 'Check Connection'}
            </Text>
          </TouchableOpacity>
        </View>
      );
  }
};

const styles = StyleSheet.create({
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
  recipient: {
    fontSize: 14,
    color: '#888',
    marginBottom: 20,
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
  buttonDisabled: {
    opacity: 0.6,
  },
});
