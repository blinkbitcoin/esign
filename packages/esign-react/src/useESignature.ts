// useESignature (web) - the headless signing flow on the core state machine.
// The transitions live in @blinkbitcoin/esign-core (signing/machine); this
// hook owns what is web-specific: navigator.onLine as the connectivity probe,
// window 'message' events (origin-pinned) or a DocuSign.js mount as the event
// transport, the success-screen delay, and how to embed the session (iframe
// props or a mount container). It renders nothing: the default ESignature
// component is one consumer, a host app's own buttons + iframe are another.

import type {
  SigningAction,
  SigningEvent,
  SigningMachineState,
  SigningSession,
  SigningSourceError,
} from '@blinkbitcoin/esign-core/webform';

import {
  acquireSession,
  initialSigningState,
  isAllowedOrigin,
  isMountable,
  resolveRestart,
  transition,
} from '@blinkbitcoin/esign-core/webform';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ESignatureEmbed,
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
  const [state, setState] = useState<SigningMachineState>(() =>
    initialSigningState({
      __testInitialStatus,
      __testSigningUrl,
      __testSession,
    }),
  );
  // The machine state is also kept in a ref: the message handler and the
  // restart read the live session without a stale closure
  const stateRef = useRef(state);
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

  const applySigningEvent = useCallback(
    (event: SigningEvent) => apply({ type: 'event', event }),
    [apply],
  );

  // Handle signing-page postMessage events (window-level: the embedded page
  // posts to window.parent). The session's allowedOrigin pins the sender.
  const handleSigningMessage = useCallback(
    (messageEvent: MessageEvent) => {
      if (!isAllowedOrigin(stateRef.current.session, messageEvent.origin)) {
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
  const usesSdkMount = isMountable<HTMLElement>(source);

  useEffect(() => {
    if (state.status !== 'signing' || usesSdkMount) {
      return;
    }
    window.addEventListener('message', handleSigningMessage);
    return () => {
      window.removeEventListener('message', handleSigningMessage);
    };
  }, [state.status, usesSdkMount, handleSigningMessage]);

  // DocuSign.js mount path: the host renders a container and hands it over
  // via the callback ref in `embed`; the mount runs once it is attached (the
  // container may appear after the status flips to signing).
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (
      state.status !== 'signing' ||
      !isMountable<HTMLElement>(source) ||
      !container
    ) {
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
  }, [state.status, source, container, applySigningEvent]);

  const sign = useCallback(async () => {
    // Check connectivity BEFORE any API call; offline is an expected state,
    // not an error, so onError is not called
    if (!isOnline()) {
      apply({ type: 'offline' });
      return;
    }
    await beginSigning(() => source.start());
  }, [apply, beginSigning, source]);

  const checkConnection = useCallback(() => {
    if (isOnline()) {
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
