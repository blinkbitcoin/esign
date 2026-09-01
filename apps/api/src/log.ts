// Log-safety helper: strip CR/LF (and other control chars) from any value
// interpolated into a log line, so attacker-controlled fields (contractType,
// rawStatus, ...) cannot forge log entries or break log-shipping parsers
// (CWE-117 log injection).

// C0 control characters (U+0000-U+001F, includes CR and LF) plus DEL (U+007F).
// Built via RegExp(string) so the source contains no literal control bytes.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f]', 'g');

export const sanitizeForLog = (value: unknown): string => {
  const str = typeof value === 'string' ? value : String(value);
  return str.replace(CONTROL_CHARS, '�');
};
