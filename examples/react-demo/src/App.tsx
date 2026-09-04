// Demo host app for the @blinkbitcoin/esign-react web component.
// Mirrors the RN demo: provider wiring + result reporting around the
// library component.
import React, { useState } from 'react';
import { ApolloProvider } from '@apollo/client/react';
import {
  ESignature,
  createProxySigningSource,
  createWebFormsSource,
  createPublicUrlSource,
  type SigningSource,
  type ESignatureResult,
  type ESignatureError,
} from '@blinkbitcoin/esign-react';

import { apolloClient, getAuthToken } from './apollo';
import { ESIGN_MODE, WEBFORM_INSTANCE_URL, PUBLIC_FORM_URL } from './config';
import { HookSigning } from './HookSigning';

export const DEMO_RECIPIENT = { name: 'Test User', email: 'test@example.com' };

// Build the signing source for the configured mode (VITE_ESIGN_MODE). The
// component and callbacks are identical across modes.
export const buildSource = (): SigningSource => {
  switch (ESIGN_MODE) {
    case 'webform':
      return createWebFormsSource({
        createInstance: async () => {
          const res = await fetch(WEBFORM_INSTANCE_URL, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${getAuthToken()}`,
            },
            body: JSON.stringify({
              prefill: {
                full_name: DEMO_RECIPIENT.name,
                email: DEMO_RECIPIENT.email,
              },
            }),
          });
          if (!res.ok) {
            throw new Error(`Could not start signing (HTTP ${res.status})`);
          }
          return res.json();
        },
      });
    case 'publicurl':
      // No backend call - just embed a published form URL (prefill in the URL).
      return createPublicUrlSource({ url: PUBLIC_FORM_URL });
    default:
      return createProxySigningSource({
        client: apolloClient,
        contractType: 'loan_agreement',
        recipient: DEMO_RECIPIENT,
      });
  }
};

type Outcome =
  | { kind: 'completed'; result: ESignatureResult }
  | { kind: 'error'; error: ESignatureError }
  | { kind: 'cancelled' }
  | null;

export const outcomeText = (outcome: Outcome): string => {
  switch (outcome?.kind) {
    case 'completed':
      return `✓ Document signed! Envelope: ${outcome.result.envelopeId}`;
    case 'error':
      return `✗ ${outcome.error.code}: ${outcome.error.message}`;
    case 'cancelled':
      return 'Signing was cancelled.';
    default:
      return '';
  }
};

// Outcome handlers, extracted so they are directly testable (mirrors the
// RN demo's exported handlers)
export const makeOutcomeHandlers = (setOutcome: (o: Outcome) => void) => ({
  onComplete: (result: ESignatureResult) =>
    setOutcome({ kind: 'completed', result }),
  onError: (error: ESignatureError) => setOutcome({ kind: 'error', error }),
  onCancel: () => setOutcome({ kind: 'cancelled' }),
});

// Two ways to host the flow: the library's default UI (the E2E target) or
// the app's own UI over the useESignature hook (HookSigning.tsx)
type UiMode = 'default' | 'hook';

export const App: React.FC = () => {
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [uiMode, setUiMode] = useState<UiMode>('default');
  const handlers = makeOutcomeHandlers(setOutcome);

  // Source for the configured mode (proxy envelope or DocuSign Web Forms).
  // The component and callbacks are identical across modes.
  const source = buildSource();

  return (
    <ApolloProvider client={apolloClient}>
      <main
        style={{
          maxWidth: 640,
          margin: '40px auto',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <h1>@blinkbitcoin/esign-react demo ({ESIGN_MODE})</h1>
        <p>
          <button
            type="button"
            data-testid="ui-mode-button"
            onClick={() =>
              setUiMode(m => (m === 'default' ? 'hook' : 'default'))
            }
          >
            {uiMode === 'default' ? 'Use hook UI' : 'Use default UI'}
          </button>
        </p>
        {uiMode === 'hook' ? (
          <HookSigning source={source} {...handlers} />
        ) : (
          <ESignature source={source} {...handlers} />
        )}
        {outcome && (
          <p data-testid="outcome" role="status">
            {outcomeText(outcome)}
          </p>
        )}
      </main>
    </ApolloProvider>
  );
};
