// The HTML sinks' helpers, tested directly (the page tests cover them only
// through rendered output).

import { escapeHtml, jsonForScript, sanitizeId } from '../html';

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('leaves everything else untouched', () => {
    expect(escapeHtml('Jane Signer 1000 0.01268231 2026-09-08 10:44 ü')).toBe(
      'Jane Signer 1000 0.01268231 2026-09-08 10:44 ü',
    );
    expect(escapeHtml('')).toBe('');
  });

  it('cannot break out of an attribute or a tag', () => {
    const attr = escapeHtml('" onfocus="alert(1)');
    expect(attr).not.toContain('"');
    const text = escapeHtml('</script><script>alert(1)</script>');
    expect(text).not.toContain('<');
    expect(text).not.toContain('>');
  });
});

describe('sanitizeId', () => {
  it.each([
    'abc-123',
    'A',
    'a'.repeat(64),
    '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b',
  ])('passes the well-formed id %j through', id => {
    expect(sanitizeId(id)).toBe(id);
  });

  it.each([
    '',
    'a'.repeat(65),
    'has space',
    'semi;colon',
    '<img src=x onerror=alert(1)>',
    '../x',
  ])('replaces the malformed id %j with "unknown"', id => {
    expect(sanitizeId(id)).toBe('unknown');
  });
});

describe('jsonForScript', () => {
  it('is JSON with every < escaped so </script> can never appear', () => {
    const out = jsonForScript('</script><script>alert(1)</script>');
    expect(out).not.toContain('<');
    expect(JSON.parse(out)).toBe('</script><script>alert(1)</script>');
  });

  it('keeps plain values as JSON.stringify would', () => {
    expect(jsonForScript('signing_complete')).toBe('"signing_complete"');
    expect(jsonForScript({ a: 1, b: [true, null] })).toBe(
      '{"a":1,"b":[true,null]}',
    );
  });
});
