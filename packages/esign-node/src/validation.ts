// Input validation for the envelope service. Bounds free-text inputs to
// limit storage/log amplification; each rule throws a VALIDATION_ERROR.

import { Errors } from './errors';
import type { RecipientData } from './types';

export const MAX_CONTRACT_TYPE_LENGTH = 100;
export const MAX_NAME_LENGTH = 200;

// Basic email format check (one @, a dotted domain, no whitespace) - written
// without a backtracking regex so a long input cannot make it slow
export const isValidEmail = (email: string): boolean => {
  const at = email.indexOf('@');
  if (at < 1 || email.indexOf('@', at + 1) !== -1 || /\s/.test(email)) {
    return false;
  }
  const domain = email.slice(at + 1);
  const dot = domain.indexOf('.');
  return dot > 0 && dot < domain.length - 1 && !domain.endsWith('.');
};

// A required identifier: present and not blank
export const requireId = (value: string | undefined, name: string): string => {
  if (!value || value.trim() === '') {
    throw Errors.validationError(`${name} is required and cannot be empty`);
  }
  return value;
};

export const validateContractType = (
  contractType: string | undefined,
): string => {
  const value = requireId(contractType, 'contractType');
  if (value.length > MAX_CONTRACT_TYPE_LENGTH) {
    throw Errors.validationError(
      `contractType must be at most ${MAX_CONTRACT_TYPE_LENGTH} characters`,
    );
  }
  return value;
};

export const validateRecipient = (recipient: RecipientData): RecipientData => {
  if (!recipient.name || recipient.name.trim() === '') {
    throw Errors.validationError(
      'recipient.name is required and cannot be empty',
    );
  }
  if (recipient.name.length > MAX_NAME_LENGTH) {
    throw Errors.validationError(
      `recipient.name must be at most ${MAX_NAME_LENGTH} characters`,
    );
  }
  if (!recipient.email || !isValidEmail(recipient.email)) {
    throw Errors.validationError(
      'recipient.email must be a valid email address',
    );
  }
  return recipient;
};
