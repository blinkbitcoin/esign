// useESignature (web) - the headless signing state machine.
// Mirrors packages/esign-react-native's hook: WebView becomes an iframe (or a
// DocuSign.js-managed mount), WebView postMessage becomes window 'message'
// events, and NetInfo becomes navigator.onLine. It renders nothing: the
// default ESignature component is one consumer, a host app's own buttons +
// iframe are another.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getErrorMessage, isRestartable } from '@blinkbitcoin/esign-core';
import { isMountable } from './docusignWebForms';
import type {
  SigningEvent,
  SigningSession,
  SigningSourceError,
} from '@blinkbitcoin/esign-core';
import type {
  ESignatureEmbed,
  ESignatureError,
  ESignatureStatus,
  UseESignatureOptions,
  UseESignatureResult,
} from './types';

const isOnline = (): boolean => navigator.onLine;

/**
 * Headless signing flow: status + actions + how to embed the active session.
 * Pair it with the default ESignature UI or render your own.
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
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lets async work detect unmount (in-flight source.start())
  const mountedRef = useRef(true);

  // Cleanup on unmount: cancel the success timeout, mark unmounted.
  // Re-arms on mount: StrictMode mounts, runs cleanup, then mounts again -
  // without this line the guard would stay false after the dev double-mount
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

  // Drive the state machine from a normalized SigningEvent. Shared by the
  // postMessage path (raw iframe) and the DocuSign.js mount path.
  const applySigningEvent = useCallback(
    (signingEvent: SigningEvent) => {
      switch (signingEvent.type) {
        case 'complete': {
          setStatus('success');
          successTimeoutRef.current = setTimeout(() => {
            onComplete({
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
    [onComplete, onCancel, onError, successDelayMs],
  );

  // Handle signing-page postMessage events (window-level: the embedded page
  // posts to window.parent). The session's allowedOrigin pins the sender.
  const handleSigningMessage = useCallback(
    (messageEvent: MessageEvent) => {
      const allowedOrigin = sessionRef.current?.allowedOrigin;
      if (allowedOrigin && messageEvent.origin !== allowedOrigin) {
        return; // Ignore messages from unexpected origins
      }
      const signingEvent = source.interpret(messageEvent.data);
      if (!signingEvent) {
        return; // Unrelated message (devtools, extensions, other embeds)
      }
      applySigningEvent(signingEvent);
    },
    [source, applySigningEvent],
  );

  // Embedding: DocuSign.js sources mount themselves (SDK-managed iframe +
  // events); all others use a plain iframe + window postMessage.
  const usesSdkMount = isMountable(source);

  useEffect(() => {
    if (status !== 'signing' || usesSdkMount) {
      return;
    }
    window.addEventListener('message', handleSigningMessage);
    return () => {
      window.removeEventListener('message', handleSigningMessage);
    };
  }, [status, usesSdkMount, handleSigningMessage]);

  // DocuSign.js mount path: the host renders a container and hands it over
  // via the callback ref in `embed`; the mount runs once it is attached (the
  // container may appear after the status flips to signing).
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (status !== 'signing' || !isMountable(source) || !container) {
      return;
    }
    let unmount: (() => void) | undefined;
    let active = true;
    source
      .mount(container, applySigningEvent)
      .then(cleanup => {
        if (active) {
          unmount = cleanup;
        } else {
          cleanup();
        }
      })
      .catch((e: SigningSourceError) => {
        const code = e?.code ?? 'SIGNING_ERROR';
        applySigningEvent({ type: 'error', code, message: e?.message });
      });
    return () => {
      active = false;
      unmount?.();
    };
  }, [status, source, container, applySigningEvent]);

  const sign = useCallback(async () => {
    // Check connectivity BEFORE any API call; offline is an expected state,
    // not an error, so onError is not called
    if (!isOnline()) {
      setStatus('offline');
      return;
    }
    await beginSigning(() => source.start());
  }, [beginSigning, source]);

  const checkConnection = useCallback(() => {
    if (isOnline()) {
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

  // Session-expiration restart (only for restartable sources)
  const restart = useCallback(async () => {
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

  const embed = useMemo<ESignatureEmbed>(() => {
    if (status !== 'signing') {
      return null;
    }
    if (usesSdkMount) {
      return { kind: 'mount', ref: setContainer };
    }
    if (signingUrl) {
      return {
        kind: 'iframe',
        iframeProps: { src: signingUrl, title: 'Document signing' },
      };
    }
    return null;
  }, [status, usesSdkMount, signingUrl]);

  return {
    status,
    error,
    signingUrl,
    isSessionExpired: error?.code === 'SESSION_EXPIRED',
    sign,
    cancel,
    retry,
    restart,
    checkConnection,
    embed,
  };
};
