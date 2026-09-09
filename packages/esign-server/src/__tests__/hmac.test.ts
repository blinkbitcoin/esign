// Default import = the real module object, so spies reach hmac.ts's binding
import crypto from 'node:crypto';
import { validateHmac } from '../hmac';
import type { Logger } from '../log';

const key = 'test-hmac-key-0123456789';
const body = '{"data":{"envelopeId":"secret-123","email":"pii@example.com"}}';

const sign = (payload: string, secret = key) =>
  crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('base64');

const fakeLogger = (): Logger & {
  log: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
} => ({ log: jest.fn(), warn: jest.fn(), error: jest.fn() });

// The JSON security event logged through `error('Security event:', json)`
const securityEvent = (logger: { error: jest.Mock }) => {
  expect(logger.error).toHaveBeenCalledWith(
    'Security event:',
    expect.any(String),
  );
  return JSON.parse(logger.error.mock.calls[0][1]) as Record<string, unknown>;
};

describe('validateHmac', () => {
  describe('key-missing policy', () => {
    it('fails closed without a key, logging a security event', () => {
      const logger = fakeLogger();
      expect(
        validateHmac(sign(body), body, { hmacKey: undefined, logger }),
      ).toBe(false);
      expect(securityEvent(logger)).toEqual({
        event: 'Webhook HMAC key not configured - webhook rejected',
        timestamp: expect.any(String),
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('treats an empty key as missing', () => {
      const logger = fakeLogger();
      expect(validateHmac(sign(body), body, { hmacKey: '', logger })).toBe(
        false,
      );
      expect(logger.error).toHaveBeenCalled();
    });

    it('accepts with a warning when the host explicitly allows a missing key', () => {
      const logger = fakeLogger();
      expect(
        validateHmac(undefined, body, {
          hmacKey: undefined,
          allowMissingKey: true,
          logger,
        }),
      ).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        '⚠️ Webhook HMAC key not configured - webhook validation disabled',
      );
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('does not apply the allowance once a key is configured', () => {
      const logger = fakeLogger();
      expect(
        validateHmac(undefined, body, {
          hmacKey: key,
          allowMissingKey: true,
          logger,
        }),
      ).toBe(false);
    });
  });

  describe('signature presence', () => {
    it.each([undefined, '', '   '])('rejects a %p signature', signature => {
      const logger = fakeLogger();
      expect(validateHmac(signature, body, { hmacKey: key, logger })).toBe(
        false,
      );
      expect(securityEvent(logger).event).toBe(
        'Webhook received without signature',
      );
    });
  });

  describe('verification', () => {
    it('accepts a valid HMAC-SHA256 base64 signature over the raw body', () => {
      const logger = fakeLogger();
      expect(validateHmac(sign(body), body, { hmacKey: key, logger })).toBe(
        true,
      );
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('validates the empty body and a large body', () => {
      expect(validateHmac(sign(''), '', { hmacKey: key })).toBe(true);
      const large = JSON.stringify({ data: 'x'.repeat(100_000) });
      expect(validateHmac(sign(large), large, { hmacKey: key })).toBe(true);
    });

    it('is bound to the key: a signature under another key fails', () => {
      const logger = fakeLogger();
      expect(
        validateHmac(sign(body, 'other-key'), body, { hmacKey: key, logger }),
      ).toBe(false);
      expect(securityEvent(logger).event).toBe(
        'HMAC signature verification failed',
      );
    });

    it('is bound to the body: a signature over other bytes fails', () => {
      const logger = fakeLogger();
      const tampered = body.replace('secret-123', 'secret-124');
      expect(validateHmac(sign(body), tampered, { hmacKey: key, logger })).toBe(
        false,
      );
      expect(securityEvent(logger).event).toBe(
        'HMAC signature verification failed',
      );
    });

    it('rejects a same-length signature with different content (timing-safe path)', () => {
      const logger = fakeLogger();
      const chars = sign(body).split('');
      chars[2] = chars[2] === 'A' ? 'B' : 'A';
      expect(validateHmac(chars.join(''), body, { hmacKey: key, logger })).toBe(
        false,
      );
      expect(securityEvent(logger).event).toBe(
        'HMAC signature verification failed',
      );
    });

    it('rejects a signature of the wrong length before comparing', () => {
      const logger = fakeLogger();
      expect(validateHmac('aW52YWxpZA==', body, { hmacKey: key, logger })).toBe(
        false,
      );
      expect(securityEvent(logger).event).toBe(
        'HMAC signature length mismatch',
      );
    });

    it('rejects malformed base64 without throwing', () => {
      const logger = fakeLogger();
      expect(
        validateHmac('!!!not-valid-base64!!!', body, { hmacKey: key, logger }),
      ).toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });

    it('returns false and logs the message when the comparison throws an Error', () => {
      const spy = jest
        .spyOn(crypto, 'timingSafeEqual')
        .mockImplementation(() => {
          throw new Error('simulated crypto failure');
        });
      const logger = fakeLogger();
      expect(validateHmac(sign(body), body, { hmacKey: key, logger })).toBe(
        false,
      );
      expect(securityEvent(logger).event).toBe(
        'HMAC validation error - simulated crypto failure',
      );
      spy.mockRestore();
    });

    it('logs "unknown error" when the comparison throws a non-Error', () => {
      const spy = jest
        .spyOn(crypto, 'timingSafeEqual')
        .mockImplementation(() => {
          throw 'a non-Error rejection';
        });
      const logger = fakeLogger();
      expect(validateHmac(sign(body), body, { hmacKey: key, logger })).toBe(
        false,
      );
      expect(securityEvent(logger).event).toBe(
        'HMAC validation error - unknown error',
      );
      spy.mockRestore();
    });
  });

  describe('security event logging', () => {
    it('includes the client ip when given, never the body', () => {
      const logger = fakeLogger();
      validateHmac('aW52YWxpZA==', body, {
        hmacKey: key,
        ip: '192.168.1.100',
        logger,
      });
      const event = securityEvent(logger);
      expect(event).toEqual({
        event: 'HMAC signature length mismatch',
        timestamp: expect.any(String),
        ip: '192.168.1.100',
      });
      expect(new Date(event.timestamp as string).toISOString()).toBe(
        event.timestamp,
      );
      const logged = JSON.stringify(logger.error.mock.calls);
      expect(logged).not.toContain('pii@example.com');
      expect(logged).not.toContain('secret-123');
    });

    it('omits ip when not given', () => {
      const logger = fakeLogger();
      validateHmac(undefined, body, { hmacKey: key, logger });
      expect(securityEvent(logger)).not.toHaveProperty('ip');
    });

    it('logs through console by default', () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

      expect(
        validateHmac(undefined, body, { hmacKey: key, ip: '10.0.0.1' }),
      ).toBe(false);
      expect(error).toHaveBeenCalledWith(
        'Security event:',
        expect.stringContaining('"ip":"10.0.0.1"'),
      );

      expect(
        validateHmac(undefined, body, {
          hmacKey: undefined,
          allowMissingKey: true,
        }),
      ).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);

      error.mockRestore();
      warn.mockRestore();
    });
  });
});
