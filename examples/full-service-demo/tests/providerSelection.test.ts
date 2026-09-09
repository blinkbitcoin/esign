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
      const provider = getProvider('mock');

      // Assert - MockProvider returns specific URL pattern
      const result = await provider.createEnvelope('user-1', 'contract', {
        name: 'Test',
        email: 'test@test.com',
      });
      expect(result.signingUrl).toContain('http://localhost:4000/signing/mock/');
      expect(result.envelopeId).toBeDefined();
    });
  });

  describe('when providerName is "docusign"', () => {
    const REQUIRED_ENV_VARS = [
      'DOCUSIGN_ACCOUNT_ID',
      'DOCUSIGN_INTEGRATION_KEY',
      'DOCUSIGN_PRIVATE_KEY',
      'DOCUSIGN_USER_ID',
      'DOCUSIGN_TEMPLATE_ID',
    ];

    const setDocuSignConfig = () => {
      for (const name of REQUIRED_ENV_VARS) {
        process.env[name] = `test-${name.toLowerCase()}`;
      }
    };

    afterEach(() => {
      for (const name of REQUIRED_ENV_VARS) {
        delete process.env[name];
      }
    });

    it('should return DocuSignProvider when config is present', () => {
      // Arrange
      setDocuSignConfig();

      // Act
      const provider = getProvider('docusign');

      // Assert - should return a provider with the expected interface
      expect(provider).toBeDefined();
      expect(typeof provider.createEnvelope).toBe('function');
      expect(typeof provider.getEnvelopeStatus).toBe('function');
    });

    it('should throw at startup when DocuSign config is missing (fail-fast)', () => {
      // Act & Assert - misconfiguration must fail at provider selection,
      // not surface as a cryptic crypto error on the first request
      expect(() => getProvider('docusign')).toThrow(
        /Missing required environment variables.*DOCUSIGN_ACCOUNT_ID/
      );
    });

    it('should name every missing variable in the error', () => {
      // Arrange - set only one of the five required vars
      process.env.DOCUSIGN_ACCOUNT_ID = 'test-account-id';

      // Act & Assert
      expect(() => getProvider('docusign')).toThrow(
        /DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_PRIVATE_KEY, DOCUSIGN_USER_ID, DOCUSIGN_TEMPLATE_ID/
      );
    });
  });

  describe('when providerName is unknown value', () => {
    it('should warn and fallback to MockProvider', async () => {
      // Arrange
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Act
      const provider = getProvider('unknown-provider');

      // Assert - falls back to mock
      const result = await provider.createEnvelope('user-1', 'contract', {
        name: 'Test',
        email: 'test@test.com',
      });
      expect(result.signingUrl).toContain('http://localhost:4000/signing/mock/');

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
      const provider = getProvider('');

      // Assert - falls back to mock (empty string triggers default case)
      const result = await provider.createEnvelope('user-1', 'contract', {
        name: 'Test',
        email: 'test@test.com',
      });
      expect(result.signingUrl).toContain('http://localhost:4000/signing/mock/');

      warnSpy.mockRestore();
    });
  });
});
