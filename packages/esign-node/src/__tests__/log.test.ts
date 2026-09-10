import { consoleLogger, sanitizeForLog } from '../log';

describe('consoleLogger', () => {
  it('binds to console late, so spies installed after import are honoured', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    consoleLogger.log('l', 1);
    consoleLogger.warn('w', { a: 1 });
    consoleLogger.error('e', 'x', 'y');

    expect(log).toHaveBeenCalledWith('l', 1);
    expect(warn).toHaveBeenCalledWith('w', { a: 1 });
    expect(error).toHaveBeenCalledWith('e', 'x', 'y');

    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });
});

describe('sanitizeForLog', () => {
  it('replaces CR/LF so a value cannot forge a log line', () => {
    expect(sanitizeForLog('ok\r\nFAKE: entry')).toBe('ok��FAKE: entry');
  });

  it('replaces every C0 control character and DEL', () => {
    expect(sanitizeForLog('a\u0000b\u001fc\u007fd')).toBe(
      'a\ufffdb\ufffdc\ufffdd',
    );
    expect(sanitizeForLog('\tx\u001e')).toBe('\ufffdx\ufffd');
  });

  it('leaves printable text untouched', () => {
    expect(sanitizeForLog('completed')).toBe('completed');
    expect(sanitizeForLog('ünïcödé ok')).toBe('ünïcödé ok');
  });

  it('stringifies non-string values', () => {
    expect(sanitizeForLog(42)).toBe('42');
    expect(sanitizeForLog(null)).toBe('null');
    expect(sanitizeForLog(undefined)).toBe('undefined');
    expect(sanitizeForLog({ toString: () => 'x\ny' })).toBe('x�y');
  });
});
