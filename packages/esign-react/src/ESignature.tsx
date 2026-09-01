// ESignature component (web) - iframe-embedded e-signature signing flow.
// Mirrors packages/esign-react-native's state machine: WebView becomes
// an iframe, WebView postMessage becomes window 'message' events, and
// NetInfo becomes navigator.onLine.

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { getErrorMessage, isRestartable } from '@blinkbitcoin/esign-core';
import { isMountable } from './docusignWebForms';
import type {
  SigningEvent,
  SigningSession,
  SigningSourceError,
} from '@blinkbitcoin/esign-core';
import type {
  ESignatureProps,
  ESignatureStatus,
  ESignatureError,
} from './types';

// Re-exported for backwards-compatible imports; canonical home is signing/.
export {
  getErrorMessage,
  getApolloErrorCode,
} from '@blinkbitcoin/esign-core';

/**
 * ESignature component for the document signing flow on web (iframe-embedded).
 * Provider-agnostic: drives a SigningSource (proxy / Web Forms / public URL).
 * Mirrors the RN component; WebView becomes an iframe, WebView onMessage
 * becomes window 'message' events, NetInfo becomes navigator.onLine.
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
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timeout on unmount to prevent post-unmount callbacks
  useEffect(() => {
    return () => {
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
        sessionRef.current = session;
        setSigningUrl(session.url);
        setStatus('signing');
      } catch (e) {
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
  const containerRef = useRef<HTMLDivElement | null>(null);
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

  // DocuSign.js mount path: hand the container to the source, forward its
  // normalized events into the same state machine.
  useEffect(() => {
    if (status !== 'signing' || !isMountable(source) || !containerRef.current) {
      return;
    }
    let unmount: (() => void) | undefined;
    let active = true;
    source
      .mount(containerRef.current, applySigningEvent)
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
  }, [status, source, applySigningEvent]);

  const isOnline = (): boolean => navigator.onLine;

  const handleSign = () => {
    // Check connectivity BEFORE any API call; offline is an expected state,
    // not an error, so onError is not called
    if (!isOnline()) {
      setStatus('offline');
      return;
    }
    beginSigning(() => source.start());
  };

  const handleCheckConnection = () => {
    if (isOnline()) {
      setStatus('idle');
    }
    // If still offline, remain in offline status (user can retry)
  };

  const handleRetry = () => {
    setError(null);
    setSigningUrl(null);
    sessionRef.current = null;
    setStatus('idle');
  };

  // Session-expiration restart (only for restartable sources)
  const handleRestart = () => {
    if (!isRestartable(source)) {
      handleRetry();
      return;
    }
    const restartable = source;
    const session = sessionRef.current;
    /* istanbul ignore next -- the restart button only appears after a
       SESSION_EXPIRED event, which preserves sessionRef; this guard is defensive */
    if (!session) {
      handleRetry();
      return;
    }
    setError(null);
    beginSigning(() => restartable.restart(session));
  };

  switch (status) {
    case 'idle':
      return (
        <div style={styles.container}>
          <h2 style={styles.title}>{label}</h2>
          <p style={styles.subtitle}>Review and sign your document</p>
          <button
            type="button"
            style={styles.button}
            onClick={handleSign}
            data-testid="sign-document-button"
            aria-label={label}
          >
            {label}
          </button>
          <button
            type="button"
            style={styles.cancelButton}
            onClick={onCancel}
            data-testid="cancel-button"
            aria-label="Cancel signing"
          >
            Cancel
          </button>
        </div>
      );

    case 'loading':
      return (
        <div style={styles.container}>
          <div
            style={styles.spinner}
            data-testid="loading-indicator"
            role="progressbar"
            aria-label="Loading, please wait"
          />
          <p style={styles.loadingText}>Preparing document...</p>
        </div>
      );

    case 'signing':
      // DocuSign.js sources mount their own iframe into this container.
      if (usesSdkMount) {
        return (
          <div style={styles.iframeContainer}>
            <div
              ref={containerRef}
              data-testid="signing-iframe"
              style={styles.iframe}
            />
          </div>
        );
      }
      if (signingUrl) {
        return (
          <div style={styles.iframeContainer}>
            <iframe
              data-testid="signing-iframe"
              title="Document signing"
              src={signingUrl}
              style={styles.iframe}
            />
          </div>
        );
      }
      // Fallback if no signingUrl (shouldn't happen in normal flow)
      return (
        <div style={styles.container}>
          <h2 style={styles.title}>Signing in Progress</h2>
          <p style={styles.subtitle}>
            Please complete signing in the embedded page
          </p>
        </div>
      );

    case 'success':
      return (
        <div style={styles.container} data-testid="success-screen">
          <p
            style={styles.successText}
            data-testid="success-text"
            aria-label="Signing completed successfully"
          >
            ✓ Signing Complete!
          </p>
        </div>
      );

    case 'error': {
      const isSessionExpired = error?.code === 'SESSION_EXPIRED';
      return (
        <div style={styles.container}>
          <p
            style={styles.errorText}
            data-testid="error-text"
            aria-label="An error occurred"
          >
            Error
          </p>
          <p style={styles.errorMessage} data-testid="error-message">
            {error?.message || 'An error occurred'}
          </p>
          <button
            type="button"
            style={styles.button}
            onClick={isSessionExpired ? handleRestart : handleRetry}
            data-testid={isSessionExpired ? 'restart-button' : 'retry-button'}
            aria-label={isSessionExpired ? 'Restart signing' : 'Try again'}
          >
            {isSessionExpired ? 'Restart' : 'Try Again'}
          </button>
        </div>
      );
    }

    case 'offline':
      return (
        <div style={styles.container}>
          <p style={styles.offlineIcon} aria-label="No connection">
            ⚠
          </p>
          <p
            style={styles.offlineText}
            data-testid="offline-text"
            aria-label="Connection required to sign documents"
          >
            Connection required to sign documents
          </p>
          <button
            type="button"
            style={styles.button}
            onClick={handleCheckConnection}
            data-testid="check-connection-button"
            aria-label="Check connection"
          >
            Check Connection
          </button>
        </div>
      );
  }
};

// Inline styles mirroring the RN component's StyleSheet (WCAG AA colors)
const styles: Record<string, React.CSSProperties> = {
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
  recipient: { fontSize: 14, color: '#888', marginBottom: 20 },
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
