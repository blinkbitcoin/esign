// Test provider selection based on ESIGN_PROVIDER environment variable
import { vi } from 'vitest';

import { getProvider } from '../src/providers';
import { clearEnvelopes } from '../src/providers/mock';

describe('Provider Selection (getProvider)', () => {
  // Clean up envelopes between tests to prevent test pollution
  beforeEach(() => {
    clearEnvelopes();
  });
  describe('when providerName is "mock"', () => {
    it('should return MockProvider', async () => {
      // Arrange & Act
      const provider = getProvider({ ESIGN_PROVIDER: 'mock' });

      // Assert - MockProvider returns specific URL pattern
      const result = await provider.createEnvelope('user-1', 'contract', {
        name: 'Test',
        email: 'test@test.com',
      });
      expect(result.signingUrl).toContain('http://localhost:4100/signing/mock/');
      expect(result.envelopeId).toBeDefined();
    });
  });

  describe('when the environment selects "docusign"', () => {
    // Dummy values in the real shape - nothing here is a credential
    const CREDENTIALS = {
      DOCUSIGN_ACCOUNT_ID: 'test-account-id',
      DOCUSIGN_INTEGRATION_KEY: 'test-integration-key',
      DOCUSIGN_PRIVATE_KEY: 'test-private-key',
      DOCUSIGN_USER_ID: 'test-user-id',
    };

    it('returns the DocuSign adapter when the credentials are present', () => {
      const provider = getProvider({ ESIGN_PROVIDER: 'docusign', ...CREDENTIALS });

      expect(typeof provider.createEnvelope).toBe('function');
      expect(typeof provider.getEnvelopeStatus).toBe('function');
    });

    it('throws at selection when the credentials are missing (fail-fast)', () => {
      // Misconfiguration must fail at provider selection, not surface as a
      // cryptic crypto error on the first request
      expect(() => getProvider({ ESIGN_PROVIDER: 'docusign' })).toThrow(
        /Missing required environment variables.*DOCUSIGN_ACCOUNT_ID/
      );
    });

    it('names every missing variable in the error', () => {
      expect(() =>
        getProvider({ ESIGN_PROVIDER: 'docusign', DOCUSIGN_ACCOUNT_ID: 'test-account-id' })
      ).toThrow(/DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_PRIVATE_KEY, DOCUSIGN_USER_ID/);
    });

    it('asks for the envelope template only when envelopes are on', () => {
      // Mint only: no template is sent, so none is required
      expect(() => getProvider({ ESIGN_PROVIDER: 'docusign', ...CREDENTIALS })).not.toThrow();

      expect(() =>
        getProvider({
          ESIGN_PROVIDER: 'docusign',
          ...CREDENTIALS,
          DATABASE_URL: 'postgres://u@h/db',
        })
      ).toThrow(/DOCUSIGN_TEMPLATE_ID/);
    });
  });

  describe('when providerName is unknown value', () => {
    it('should warn and fallback to MockProvider', async () => {
      // Arrange
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Act
      const provider = getProvider({ ESIGN_PROVIDER: 'unknown-provider' });

      // Assert - falls back to mock
      const result = await provider.createEnvelope('user-1', 'contract', {
        name: 'Test',
        email: 'test@test.com',
      });
      expect(result.signingUrl).toContain('http://localhost:4100/signing/mock/');

      // Assert - warning was logged
      expect(warnSpy).toHaveBeenCalledWith(
        'Unknown ESIGN_PROVIDER: unknown-provider, falling back to mock'
      );

      warnSpy.mockRestore();
    });
  });

  describe('when providerName is empty string', () => {
    it('should warn and fallback to MockProvider', async () => {
      // Arrange
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Act
      const provider = getProvider({ ESIGN_PROVIDER: '' });

      // Assert - falls back to mock (empty string triggers default case)
      const result = await provider.createEnvelope('user-1', 'contract', {
        name: 'Test',
        email: 'test@test.com',
      });
      expect(result.signingUrl).toContain('http://localhost:4100/signing/mock/');

      warnSpy.mockRestore();
    });
  });
});
