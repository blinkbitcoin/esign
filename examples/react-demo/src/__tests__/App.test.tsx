import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { App, outcomeText, makeOutcomeHandlers } from '../App';
import { getAuthToken, apolloClient } from '../apollo';

describe('demo App', () => {
  it('renders the library component in idle state', () => {
    render(<App />);
    expect(screen.getByTestId('sign-document-button')).toBeTruthy();
    expect(screen.getByTestId('sign-document-button').textContent).toBe(
      'Sign Document',
    );
  });

  it('reports cancellation through the outcome panel', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('cancel-button'));
    expect(screen.getByTestId('outcome').textContent).toBe(
      'Signing was cancelled.',
    );
  });
});

describe('outcomeText', () => {
  it('formats all outcome kinds', () => {
    expect(
      outcomeText({
        kind: 'completed',
        result: { envelopeId: 'env-1', status: 'completed' },
      }),
    ).toContain('env-1');
    expect(
      outcomeText({
        kind: 'error',
        error: { code: 'X', message: 'boom' },
      }),
    ).toBe('✗ X: boom');
    expect(outcomeText({ kind: 'cancelled' })).toBe('Signing was cancelled.');
    expect(outcomeText(null)).toBe('');
  });
});

describe('makeOutcomeHandlers', () => {
  it('maps each callback to the right outcome', () => {
    const setOutcome = vi.fn();
    const handlers = makeOutcomeHandlers(setOutcome);

    handlers.onComplete({ envelopeId: 'env-9', status: 'completed' });
    expect(setOutcome).toHaveBeenLastCalledWith({
      kind: 'completed',
      result: { envelopeId: 'env-9', status: 'completed' },
    });

    handlers.onError({ code: 'X', message: 'boom' });
    expect(setOutcome).toHaveBeenLastCalledWith({
      kind: 'error',
      error: { code: 'X', message: 'boom' },
    });

    handlers.onCancel();
    expect(setOutcome).toHaveBeenLastCalledWith({ kind: 'cancelled' });
  });
});

describe('apollo wiring', () => {
  it('provides the fixed dev token and a configured client', () => {
    expect(getAuthToken()).toBe('mock-jwt-token');
    expect(apolloClient.link).toBeDefined();
    expect(apolloClient.cache).toBeDefined();
  });
});
