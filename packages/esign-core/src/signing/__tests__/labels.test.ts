import type { ESignatureLabels, LabelDefaults } from '../labels';
import { resolveLabelsWith } from '../labels';

interface PlatformLabels extends ESignatureLabels {
  checking?: string;
}

const defaults: LabelDefaults<PlatformLabels> = {
  subtitle: 'Review and sign',
  cancel: 'Cancel',
  loading: 'Preparing',
  signingTitle: 'Signing',
  signingSubtitle: 'Complete signing',
  success: 'Done',
  errorTitle: 'Error',
  errorFallback: 'Something went wrong',
  retry: 'Try again',
  restart: 'Restart',
  offline: 'Offline',
  checkConnection: 'Check',
  checking: 'Checking',
};

describe('resolveLabelsWith', () => {
  it('fills title and sign from the label and keeps every default', () => {
    expect(resolveLabelsWith(defaults, 'Sign Document')).toEqual({
      ...defaults,
      title: 'Sign Document',
      sign: 'Sign Document',
    });
  });

  it('applies explicit overrides and ignores null or undefined ones', () => {
    const resolved = resolveLabelsWith(defaults, 'Sign', {
      title: 'Agreement',
      cancel: undefined,
      retry: null as unknown as string,
      checking: 'One moment',
    });
    expect(resolved.title).toBe('Agreement');
    expect(resolved.sign).toBe('Sign');
    expect(resolved.cancel).toBe('Cancel');
    expect(resolved.retry).toBe('Try again');
    expect(resolved.checking).toBe('One moment');
  });
});
