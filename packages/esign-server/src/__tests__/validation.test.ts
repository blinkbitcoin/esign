import { ESignError } from '../errors';
import {
  isValidEmail,
  MAX_CONTRACT_TYPE_LENGTH,
  MAX_NAME_LENGTH,
  requireId,
  validateContractType,
  validateRecipient,
} from '../validation';

const validationError = (message: string) =>
  expect.objectContaining({
    code: 'VALIDATION_ERROR',
    message,
  });

describe('limits', () => {
  it('bounds free-text inputs', () => {
    expect(MAX_CONTRACT_TYPE_LENGTH).toBe(100);
    expect(MAX_NAME_LENGTH).toBe(200);
  });
});

describe('isValidEmail', () => {
  it('accepts an @ with a dotted domain', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('first.last+tag@sub.example.org')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a b@c.d')).toBe(false);
    expect(isValidEmail('a@@b.c')).toBe(false);
  });
});

describe('requireId', () => {
  it('returns a present, non-blank value', () => {
    expect(requireId('abc', 'envelopeId')).toBe('abc');
  });

  it.each([undefined, '', '   '])('rejects %p', value => {
    expect(() => requireId(value, 'envelopeId')).toThrow(ESignError);
    expect(() => requireId(value, 'envelopeId')).toThrow(
      validationError('envelopeId is required and cannot be empty'),
    );
  });
});

describe('validateContractType', () => {
  it('returns a valid contract type', () => {
    expect(validateContractType('nda')).toBe('nda');
    expect(validateContractType('x'.repeat(100))).toBe('x'.repeat(100));
  });

  it('rejects a missing or blank contract type', () => {
    expect(() => validateContractType(undefined)).toThrow(
      validationError('contractType is required and cannot be empty'),
    );
    expect(() => validateContractType(' ')).toThrow(
      validationError('contractType is required and cannot be empty'),
    );
  });

  it('rejects an over-long contract type', () => {
    expect(() => validateContractType('x'.repeat(101))).toThrow(
      validationError('contractType must be at most 100 characters'),
    );
  });
});

describe('validateRecipient', () => {
  const recipient = { name: 'Jane Signer', email: 'jane@example.com' };

  it('returns the recipient unchanged when valid', () => {
    expect(validateRecipient(recipient)).toBe(recipient);
    expect(
      validateRecipient({ ...recipient, name: 'n'.repeat(200) }),
    ).toMatchObject({ name: 'n'.repeat(200) });
  });

  it('rejects a missing or blank name', () => {
    expect(() =>
      validateRecipient({ ...recipient, name: undefined as unknown as string }),
    ).toThrow(
      validationError('recipient.name is required and cannot be empty'),
    );
    expect(() => validateRecipient({ ...recipient, name: '' })).toThrow(
      validationError('recipient.name is required and cannot be empty'),
    );
    expect(() => validateRecipient({ ...recipient, name: '  ' })).toThrow(
      validationError('recipient.name is required and cannot be empty'),
    );
  });

  it('rejects an over-long name', () => {
    expect(() =>
      validateRecipient({ ...recipient, name: 'n'.repeat(201) }),
    ).toThrow(validationError('recipient.name must be at most 200 characters'));
  });

  it('rejects a missing or malformed email', () => {
    expect(() =>
      validateRecipient({
        ...recipient,
        email: undefined as unknown as string,
      }),
    ).toThrow(validationError('recipient.email must be a valid email address'));
    expect(() => validateRecipient({ ...recipient, email: '' })).toThrow(
      validationError('recipient.email must be a valid email address'),
    );
    expect(() => validateRecipient({ ...recipient, email: 'nope' })).toThrow(
      validationError('recipient.email must be a valid email address'),
    );
  });
});
