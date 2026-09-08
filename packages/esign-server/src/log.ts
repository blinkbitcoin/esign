// Logging seams for the domain: a minimal logger port (console by default)
// and a log-safety helper.

export interface Logger {
  log(message: string, ...rest: unknown[]): void;
  warn(message: string, ...rest: unknown[]): void;
  error(message: string, ...rest: unknown[]): void;
}

// Late-bound console so spies installed by tests are honoured
export const consoleLogger: Logger = {
  log: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

// C0 control characters (U+0000-U+001F, includes CR and LF) plus DEL (U+007F).
// Built via RegExp(string) so the source contains no literal control bytes.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f]', 'g');

// Strip CR/LF and other control characters from any value interpolated into a
// log line, so attacker-controlled fields (contractType, rawStatus, ...) cannot
// forge log entries or break log-shipping parsers (CWE-117 log injection).
export const sanitizeForLog = (value: unknown): string => {
  const str = typeof value === 'string' ? value : String(value);
  return str.replace(CONTROL_CHARS, '�');
};
