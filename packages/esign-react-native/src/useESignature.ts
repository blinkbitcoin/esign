// useESignature - the headless signing flow on the core state machine.
// The transitions live in @blinkbitcoin/esign-core (signing/machine); this
// hook owns what is React Native-specific: NetInfo as the connectivity probe
// (with the in-flight flag the offline screen shows), WebView messages as
// the event transport, the success-screen delay, and the WebView props for
// the active session. It renders nothing: the default ESignature component
// is one consumer, a host app's own buttons + WebView are another.

import type {
  SigningAction,
  SigningMachineState,
  SigningSession,
} from '@blinkbitcoin/esign-core/webform';
import {
  acquireSession,
  initialSigningState,
  resolveRestart,
  transition,
} from '@blinkbitcoin/esign-core/webform';
import NetInfo from '@react-native-community/netinfo';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WebViewMessageEvent } from 'react-native-webview';
import type {
  ESignatureWebViewProps,
  UseESignatureOptions,
  UseESignatureResult,
} from './types';
import type { ESignLogger } from '@blinkbitcoin/esign-core/webform';

// Where dropped WebView messages are reported unless the host injects a
// logger (late-bound console, so a spy installed by a test is honoured)
const consoleLogger: ESignLogger = {
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

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
  logger = consoleLogger,
  __testInitialStatus,
  __testSigningUrl,
  __testSession,
}: UseESignatureOptions): UseESignatureResult => {
  const [state, setState] = useState<SigningMachineState>(() =>
    initialSigningState({
      __testInitialStatus,
      __testSigningUrl,
      __testSession,
    }),
  );
  // The machine state is also kept in a ref: the restart reads the live
  // session without a stale closure
  const stateRef = useRef(state);
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

  // Run one action through the machine and its effects: the success screen
  // is held for successDelayMs before onComplete fires and the url clears
  const apply = useCallback(
    (action: SigningAction) => {
      const { state: next, effects } = transition(stateRef.current, action);
      stateRef.current = next;
      setState(next);
      for (const effect of effects) {
        switch (effect.type) {
          case 'complete':
            successTimeoutRef.current = setTimeout(() => {
              onComplete(effect.result);
              apply({ type: 'settled' });
            }, successDelayMs);
            break;
          case 'error':
            onError(effect.error);
            break;
          case 'cancel':
            onCancel();
            break;
        }
      }
    },
    [onComplete, onError, onCancel, successDelayMs],
  );

  // Acquire a session (start or restart) and enter the signing state. The
  // acquire call can outlive the host (user navigated away mid-loading) - a
  // late result must not update state or fire callbacks
  const beginSigning = useCallback(
    async (acquire: () => Promise<SigningSession>) => {
      apply({ type: 'acquire' });
      const outcome = await acquireSession(acquire);
      if (mountedRef.current) {
        apply(outcome);
      }
    },
    [apply],
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
          logger.error('WebView message parse error:', e);
        }
        return;
      }

      const signingEvent = source.interpret(raw);
      if (!signingEvent) {
        /* istanbul ignore else -- __DEV__ is hardcoded true by the RN Jest preset; the false branch is a compile-time-only path Metro strips in production */
        if (__DEV__) {
          logger.warn('Unknown signing WebView event:', raw);
        }
        return;
      }
      apply({ type: 'event', event: signingEvent });
    },
    [source, apply, logger],
  );

  const sign = useCallback(async () => {
    // Check connectivity BEFORE any API call; offline is an expected state,
    // not an error, so onError is not called
    const isOnline = await checkConnectivity();
    if (!isOnline) {
      apply({ type: 'offline' });
      return;
    }
    await beginSigning(() => source.start());
  }, [apply, beginSigning, source]);

  // Track if we're actively re-checking connection from the offline state
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);

  const checkConnection = useCallback(async () => {
    setIsCheckingConnection(true);
    const isOnline = await checkConnectivity();
    setIsCheckingConnection(false);
    if (isOnline) {
      // Now online - transition to idle so the user can sign again
      apply({ type: 'online' });
    }
    // If still offline, remain in offline status (user can retry)
  }, [apply]);

  const cancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  const retry = useCallback(() => {
    apply({ type: 'retry' });
  }, [apply]);

  // Session-expiration restart: only a restartable source with a preserved
  // session can restart; anything else falls back to a fresh start
  const restart = useCallback(async () => {
    const acquire = resolveRestart(source, stateRef.current.session);
    if (!acquire) {
      retry();
      return;
    }
    apply({ type: 'restart' });
    await beginSigning(acquire);
  }, [source, retry, apply, beginSigning]);

  const { status, error, signingUrl } = state;

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
