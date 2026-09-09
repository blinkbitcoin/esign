// Escaping and sanitization for values interpolated into the HTML pages the
// service serves (signingPages.ts). Three sinks, one helper each:
//   - HTML text / attribute values → escapeHtml
//   - identifiers echoed into markup → sanitizeId (allow-list, never escape)
//   - JSON embedded in a <script> block → jsonForScript

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

// Escape text for interpolation into HTML content or a double/single-quoted
// attribute value
export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

// Strict allow-list sanitization for identifiers (envelope / instance ids)
// interpolated into HTML: anything outside [a-zA-Z0-9-]{1,64} becomes 'unknown'
export const sanitizeId = (value: string): string =>
  /^[a-zA-Z0-9-]{1,64}$/.test(value) ? value : 'unknown';

// JSON for embedding inside a <script> block. JSON.stringify does not escape
// '<' or '/', so a value containing '</script>' could otherwise break out.
// Escaping '<' to < closes that hole even if a raw value ever reaches
// this sink (defense in depth - callers already pass fixed enum values).
export const jsonForScript = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, '\\u003c');
