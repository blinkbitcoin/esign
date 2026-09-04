// ESignature component (web) - the default UI over the useESignature hook.
// Mirrors packages/esign-react-native's component: the WebView becomes an
// iframe (or a DocuSign.js-managed mount container). The state machine lives
// in useESignature; this file owns only the built-in screens, which a host
// can recolor (`theme`), restyle (`styles`), and relabel (`labels`) - or
// replace entirely by using the hook directly.

import React, { useMemo } from 'react';

import { useESignature } from './useESignature';
import { resolveLabels, resolveStyles } from './theme';
import type { ESignatureProps } from './types';

// Re-exported for backwards-compatible imports; canonical home is signing/.
export {
  getErrorMessage,
  getApolloErrorCode,
} from '@blinkbitcoin/esign-core';

/**
 * ESignature component for the document signing flow on web (iframe-embedded).
 * Provider-agnostic: drives a SigningSource (proxy / Web Forms / public URL).
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
    sign,
    cancel,
    retry,
    restart,
    checkConnection,
    embed,
  } = useESignature(options);

  const s = useMemo(() => resolveStyles(theme, styles), [theme, styles]);
  const t = useMemo(() => resolveLabels(label, labels), [label, labels]);

  switch (status) {
    case 'idle':
      return (
        <div style={s.container}>
          <h2 style={s.title}>{t.title}</h2>
          <p style={s.subtitle}>{t.subtitle}</p>
          <button
            type="button"
            style={s.button}
            onClick={sign}
            data-testid="sign-document-button"
            aria-label={t.sign}
          >
            {t.sign}
          </button>
          <button
            type="button"
            style={s.cancelButton}
            onClick={cancel}
            data-testid="cancel-button"
            aria-label="Cancel signing"
          >
            {t.cancel}
          </button>
        </div>
      );

    case 'loading':
      return (
        <div style={s.container}>
          <div
            style={s.spinner}
            data-testid="loading-indicator"
            role="progressbar"
            aria-label="Loading, please wait"
          />
          <p style={s.loadingText}>{t.loading}</p>
        </div>
      );

    case 'signing':
      // DocuSign.js sources mount their own iframe into this container.
      if (embed?.kind === 'mount') {
        return (
          <div style={s.iframeContainer}>
            <div
              ref={embed.ref}
              data-testid="signing-iframe"
              style={s.iframe}
            />
          </div>
        );
      }
      if (embed) {
        return (
          <div style={s.iframeContainer}>
            <iframe
              {...embed.iframeProps}
              data-testid="signing-iframe"
              style={s.iframe}
            />
          </div>
        );
      }
      // Fallback if no signingUrl (shouldn't happen in normal flow)
      return (
        <div style={s.container}>
          <h2 style={s.title}>{t.signingTitle}</h2>
          <p style={s.subtitle}>{t.signingSubtitle}</p>
        </div>
      );

    case 'success':
      return (
        <div style={s.container} data-testid="success-screen">
          <p
            style={s.successText}
            data-testid="success-text"
            aria-label="Signing completed successfully"
          >
            {t.success}
          </p>
        </div>
      );

    case 'error':
      return (
        <div style={s.container}>
          <p
            style={s.errorText}
            data-testid="error-text"
            aria-label="An error occurred"
          >
            {t.errorTitle}
          </p>
          <p style={s.errorMessage} data-testid="error-message">
            {error?.message || t.errorFallback}
          </p>
          <button
            type="button"
            style={s.button}
            onClick={isSessionExpired ? restart : retry}
            data-testid={isSessionExpired ? 'restart-button' : 'retry-button'}
            aria-label={isSessionExpired ? 'Restart signing' : 'Try again'}
          >
            {isSessionExpired ? t.restart : t.retry}
          </button>
        </div>
      );

    case 'offline':
      return (
        <div style={s.container}>
          <p style={s.offlineIcon} aria-label="No connection">
            ⚠
          </p>
          <p
            style={s.offlineText}
            data-testid="offline-text"
            aria-label="Connection required to sign documents"
          >
            {t.offline}
          </p>
          <button
            type="button"
            style={s.button}
            onClick={checkConnection}
            data-testid="check-connection-button"
            aria-label="Check connection"
          >
            {t.checkConnection}
          </button>
        </div>
      );
  }
};
