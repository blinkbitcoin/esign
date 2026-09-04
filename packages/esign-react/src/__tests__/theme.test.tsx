/**
 * theme resolvers (web) - how a host's theme / styles / labels layer onto
 * the default ESignature look. Precedence: base < theme < styles[key].
 */

import {
  DEFAULT_LABELS,
  baseStyles,
  resolveLabels,
  resolveStyles,
} from '../theme';

import type {
  ESignatureLabels,
  ESignatureStyleKey,
  ESignatureTheme,
} from '../types';

const STYLE_KEYS: ESignatureStyleKey[] = [
  'container',
  'iframeContainer',
  'iframe',
  'title',
  'subtitle',
  'button',
  'cancelButton',
  'spinner',
  'loadingText',
  'successText',
  'errorText',
  'errorMessage',
  'offlineText',
  'offlineIcon',
];

const FULL_THEME: Required<ESignatureTheme> = {
  primaryColor: '#111111',
  primaryTextColor: '#222222',
  mutedTextColor: '#333333',
  successColor: '#444444',
  errorColor: '#555555',
  warningColor: '#666666',
};

describe('resolveStyles', () => {
  it('with no theme or styles resolves to the base styles for every key', () => {
    const resolved = resolveStyles();
    for (const key of STYLE_KEYS) {
      expect(resolved[key]).toEqual(baseStyles[key]);
    }
  });

  it('keeps the default iOS blue on the primary and cancel buttons', () => {
    const resolved = resolveStyles();
    expect(resolved.button.backgroundColor).toBe('#007AFF');
    expect(resolved.cancelButton.color).toBe('#007AFF');
    expect(resolved.spinner.borderTopColor).toBe('#007AFF');
  });

  it.each([
    ['button', 'backgroundColor', FULL_THEME.primaryColor],
    ['button', 'color', FULL_THEME.primaryTextColor],
    ['cancelButton', 'color', FULL_THEME.primaryColor],
    ['spinner', 'borderTopColor', FULL_THEME.primaryColor],
    ['subtitle', 'color', FULL_THEME.mutedTextColor],
    ['loadingText', 'color', FULL_THEME.mutedTextColor],
    ['errorMessage', 'color', FULL_THEME.mutedTextColor],
    ['offlineText', 'color', FULL_THEME.mutedTextColor],
    ['successText', 'color', FULL_THEME.successColor],
    ['errorText', 'color', FULL_THEME.errorColor],
    ['offlineIcon', 'color', FULL_THEME.warningColor],
  ] as const)('theme colors %s.%s', (key, prop, expected) => {
    const resolved = resolveStyles(FULL_THEME);
    expect(resolved[key][prop]).toBe(expected);
  });

  it('a partial theme leaves the other colors at their defaults', () => {
    const resolved = resolveStyles({ primaryColor: '#F7931A' });
    expect(resolved.button.backgroundColor).toBe('#F7931A');
    expect(resolved.button.color).toBe('#fff');
    expect(resolved.successText.color).toBe('#1E7E34');
  });

  it('per-element styles win over the theme and apply to every key', () => {
    const overrides = Object.fromEntries(
      STYLE_KEYS.map(key => [key, { marginTop: 42 }]),
    );
    const resolved = resolveStyles(FULL_THEME, {
      ...overrides,
      button: { backgroundColor: '#ABCDEF', marginTop: 42 },
    });
    expect(resolved.button.backgroundColor).toBe('#ABCDEF');
    for (const key of STYLE_KEYS) {
      expect(resolved[key].marginTop).toBe(42);
    }
  });
});

describe('resolveLabels', () => {
  it('uses the defaults with label as title and sign', () => {
    expect(resolveLabels('Sign Document')).toEqual({
      ...DEFAULT_LABELS,
      title: 'Sign Document',
      sign: 'Sign Document',
    });
  });

  it('every key can be overridden', () => {
    const all: Required<ESignatureLabels> = {
      title: 't',
      subtitle: 'st',
      sign: 's',
      cancel: 'c',
      loading: 'l',
      signingTitle: 'sit',
      signingSubtitle: 'sis',
      success: 'su',
      errorTitle: 'et',
      errorFallback: 'ef',
      retry: 'r',
      restart: 'rs',
      offline: 'o',
      checkConnection: 'cc',
    };
    expect(resolveLabels('ignored', all)).toEqual(all);
  });

  it('an explicit undefined keeps the default rather than blanking it', () => {
    const resolved = resolveLabels('Sign', {
      cancel: undefined,
      retry: 'Again',
    });
    expect(resolved.cancel).toBe('Cancel');
    expect(resolved.retry).toBe('Again');
    expect(resolved.title).toBe('Sign');
  });
});
