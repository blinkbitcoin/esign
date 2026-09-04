// useESignature - the headless signing state machine.
// Provider-agnostic: drives whatever SigningSource it is given (acquisition +
// event protocol live in the source) and owns status transitions, offline
// handling, session-expiry restart, and the success delay. It renders
// nothing: the default ESignature component is one consumer, a host app's
// own buttons + WebView are another.

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { WebViewMessageEvent } from 'react-native-webview';
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
  ESignatureError,
  ESignatureStatus,
  ESignatureWebViewProps,
  UseESignatureOptions,
  UseESignatureResult,
} from './types';

const checkConnectivity = async (): Promise<boolean> => {
  const state = await NetInfo.fetch();
  return state.isConnected === true && state.isInternetReachable !== false;
};

/**
 * Headless signing flow: status + actions + the WebView props for the active
 * session. Pair it with the default ESignature UI or render your own.
 */
export const useESignature = ({
  source,
  onComplete,
  onError,
  onCancel,
  successDelayMs = 1500,
  __testInitialStatus,
  __testSigningUrl,
  __testSession,
}: UseESignatureOptions): UseESignatureResult => {
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

  // Cleanup on unmount: cancel the success timeout, mark unmounted.
  // Re-arms on mount so a StrictMode double-mount can't leave the guard stuck
  useEffect(() => {
    mountedRef.current = true;
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
        // The acquire call can outlive the host (user navigated away
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

  const sign = useCallback(async () => {
    // Check connectivity BEFORE any API call
    const isOnline = await checkConnectivity();
    if (!isOnline) {
      setStatus('offline');
      // Do NOT call onError - offline is an expected state, not an error
      return;
    }
    await beginSigning(() => source.start());
  }, [beginSigning, source]);

  // Track if we're actively re-checking connection from the offline state
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);

  const checkConnection = useCallback(async () => {
    setIsCheckingConnection(true);
    const isOnline = await checkConnectivity();
    setIsCheckingConnection(false);
    if (isOnline) {
      // Now online - transition to idle so the user can sign again
      setStatus('idle');
    }
    // If still offline, remain in offline status (user can retry)
  }, []);

  const cancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  const retry = useCallback(() => {
    setError(null);
    setSigningUrl(null);
    sessionRef.current = null;
    setStatus('idle');
  }, []);

  // Restart after session expiration. Only sources that support restart AND
  // a preserved session can restart; otherwise fall back to a full retry.
  const restart = useCallback(async () => {
    // Non-restartable sources (public URL / Web Forms) fall back to a fresh start
    if (!isRestartable(source)) {
      retry();
      return;
    }
    const restartable = source;
    const session = sessionRef.current;
    /* istanbul ignore next -- restart is only offered after a SESSION_EXPIRED
       event, which preserves sessionRef; this guard is defensive */
    if (!session) {
      retry();
      return;
    }
    setError(null);
    await beginSigning(() => restartable.restart(session));
  }, [source, retry, beginSigning]);

  const webViewProps = useMemo<ESignatureWebViewProps | null>(
    () =>
      status === 'signing' && signingUrl
        ? {
            source: { uri: signingUrl },
            onMessage: handleWebViewMessage,
            javaScriptEnabled: true,
            domStorageEnabled: true,
            startInLoadingState: true,
          }
        : null,
    [status, signingUrl, handleWebViewMessage],
  );

  return {
    status,
    error,
    signingUrl,
    isSessionExpired: error?.code === 'SESSION_EXPIRED',
    isCheckingConnection,
    sign,
    cancel,
    retry,
    restart,
    checkConnection,
    webViewProps,
  };
};
