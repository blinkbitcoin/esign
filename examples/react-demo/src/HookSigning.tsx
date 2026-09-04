// Hook-driven signing UI: the host owns every button and the iframe, the
// library owns only the state machine (useESignature). This is what an app
// with its own design system would write instead of using <ESignature>.
import React from 'react';
import {
  useESignature,
  type UseESignatureOptions,
} from '@blinkbitcoin/esign-react';

const primary: React.CSSProperties = {
  background: '#F7931A',
  color: '#fff',
  fontWeight: 700,
  border: 'none',
  borderRadius: 999,
  padding: '14px 28px',
  cursor: 'pointer',
};

export const HookSigning: React.FC<UseESignatureOptions> = options => {
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

  // DocuSign.js sources mount into a container; everything else is an iframe
  if (embed?.kind === 'mount') {
    return (
      <div
        ref={embed.ref}
        data-testid="hook-mount"
        style={{ minHeight: 480 }}
      />
    );
  }
  if (embed) {
    return (
      <iframe
        {...embed.iframeProps}
        data-testid="hook-iframe"
        style={{ width: '100%', minHeight: 480, border: 'none' }}
      />
    );
  }

  return (
    <div style={{ display: 'grid', gap: 12, justifyItems: 'center' }}>
      <small data-testid="hook-status" style={{ letterSpacing: 1 }}>
        {status.toUpperCase()}
      </small>
      {status === 'idle' && (
        <>
          <button
            type="button"
            style={primary}
            onClick={sign}
            data-testid="hook-sign-button"
          >
            Sign with our own button
          </button>
          <button
            type="button"
            onClick={cancel}
            data-testid="hook-cancel-button"
            style={{ background: 'none', border: 'none', color: '#F7931A' }}
          >
            Not now
          </button>
        </>
      )}
      {status === 'loading' && <p>Loading…</p>}
      {status === 'success' && <p style={{ color: '#1E7E34' }}>Signed ✓</p>}
      {status === 'error' && (
        <>
          <p style={{ color: '#C82333' }} data-testid="hook-error-message">
            {error?.message}
          </p>
          <button
            type="button"
            style={primary}
            onClick={isSessionExpired ? restart : retry}
            data-testid="hook-retry-button"
          >
            {isSessionExpired ? 'Restart' : 'Try again'}
          </button>
        </>
      )}
      {status === 'offline' && (
        <button
          type="button"
          style={primary}
          onClick={checkConnection}
          data-testid="hook-check-connection-button"
        >
          Reconnect
        </button>
      )}
    </div>
  );
};
