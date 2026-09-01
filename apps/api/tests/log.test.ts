// Tests for the log-injection sanitizer.

import { sanitizeForLog } from '../src/log';

describe('sanitizeForLog', () => {
  it('passes through ordinary strings unchanged', () => {
    expect(sanitizeForLog('loan_agreement')).toBe('loan_agreement');
  });

  it('strips CR and LF (log-forging characters)', () => {
    expect(sanitizeForLog('ok\ninjected')).not.toContain('\n');
    expect(sanitizeForLog('ok\r\ninjected')).not.toContain('\r');
  });

  it('strips other C0 control characters and DEL', () => {
    // 'a' + NUL + 'b' + US(0x1f) + DEL(0x7f) + 'c'
    const input =
      'a' +
      String.fromCharCode(0x00) +
      'b' +
      String.fromCharCode(0x1f) +
      String.fromCharCode(0x7f) +
      'c';
    expect(sanitizeForLog(input)).toBe('a�b��c');
  });

  it('coerces non-string values to string', () => {
    expect(sanitizeForLog(42)).toBe('42');
    expect(sanitizeForLog(undefined)).toBe('undefined');
    expect(sanitizeForLog(null)).toBe('null');
  });
});
