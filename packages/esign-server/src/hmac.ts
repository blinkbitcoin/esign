// HMAC-SHA256 webhook signature validation with the key-missing policy:
// without a key the webhook is rejected (fail closed) unless the host
// explicitly allows unsigned webhooks (local dev against a mock provider).

import { createHmac, timingSafeEqual } from 'node:crypto';
import { consoleLogger, type Logger } from './log';

export interface ValidateHmacOptions {
  // The provider's webhook signing secret
  hmacKey: string | undefined;
  // Allow (with a warning) when no key is configured; default false
  allowMissingKey?: boolean;
  // Client IP for security logging
  ip?: string;
  logger?: Logger;
}

// Log a security event with timestamp and optional IP (no PII)
const logSecurityEvent = (
  logger: Logger,
  message: string,
  ip?: string,
): void => {
  logger.error(
    'Security event:',
    JSON.stringify({
      event: message,
      timestamp: new Date().toISOString(),
      ...(ip && { ip }),
    }),
  );
};

// Validate a base64 HMAC-SHA256 signature over the raw webhook body (the
// exact bytes received - re-serializing would change the signature).
export const validateHmac = (
  signature: string | undefined,
  body: string,
  options: ValidateHmacOptions,
): boolean => {
  const logger = options.logger ?? consoleLogger;
  const { hmacKey, ip } = options;

  if (!hmacKey) {
    if (!options.allowMissingKey) {
      logSecurityEvent(
        logger,
        'Webhook HMAC key not configured - webhook rejected',
        ip,
      );
      return false;
    }
    logger.warn(
      '⚠️ Webhook HMAC key not configured - webhook validation disabled',
    );
    return true;
  }

  if (!signature || signature.trim() === '') {
    logSecurityEvent(logger, 'Webhook received without signature', ip);
    return false;
  }

  try {
    const expected = createHmac('sha256', hmacKey)
      .update(body, 'utf8')
      .digest('base64');
    const signatureBuffer = Buffer.from(signature, 'base64');
    const expectedBuffer = Buffer.from(expected, 'base64');

    // timingSafeEqual needs equal lengths; a mismatch is already a failure
    if (signatureBuffer.length !== expectedBuffer.length) {
      logSecurityEvent(logger, 'HMAC signature length mismatch', ip);
      return false;
    }
    const valid = timingSafeEqual(signatureBuffer, expectedBuffer);
    if (!valid) {
      logSecurityEvent(logger, 'HMAC signature verification failed', ip);
    }
    return valid;
  } catch (error) {
    logSecurityEvent(
      logger,
      `HMAC validation error - ${error instanceof Error ? error.message : 'unknown error'}`,
      ip,
    );
    return false;
  }
};
