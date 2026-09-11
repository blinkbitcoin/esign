// The prefill contracts: what reaches DocuSign, and how a value displays.

import {
  assertEnvelopePrefill,
  assertWebFormPrefill,
  formatPrefillValue,
  MAX_PREFILL_FIELDS,
  PrefillError,
  parseEnvelopePrefill,
  parseWebFormPrefill,
  WebFormPrefillError,
} from '../prefill';

describe('assertWebFormPrefill', () => {
  it('returns the prefill or throws a PrefillError with the reason', () => {
    expect(assertWebFormPrefill({ a: 'b' })).toEqual({ a: 'b' });
    expect(assertWebFormPrefill(undefined)).toEqual({});
    expect(() => assertWebFormPrefill([])).toThrow(PrefillError);
    expect(() => assertWebFormPrefill([])).toThrow(
      'Invalid prefill: prefill must be an object',
    );
    try {
      assertWebFormPrefill({ 'bad name': 1 });
    } catch (error) {
      expect((error as Error).name).toBe('PrefillError');
    }
  });

  // The old name still resolves, and still catches the same error
  it('keeps WebFormPrefillError as the same class', () => {
    expect(WebFormPrefillError).toBe(PrefillError);
    expect(() => assertWebFormPrefill(null)).toThrow(WebFormPrefillError);
  });
});

describe('parseEnvelopePrefill', () => {
  it('treats a missing prefill as empty', () => {
    expect(parseEnvelopePrefill(undefined)).toEqual({ ok: true, prefill: {} });
  });

  it('accepts text, bare or with a boolean lock', () => {
    const prefill = {
      total_usd: { value: '10.00', locked: true },
      country: 'Honduras',
      note: { value: 'free to change' },
      memo: { value: 'unlocked on purpose', locked: false },
      blank: '',
    };
    expect(parseEnvelopePrefill(prefill)).toEqual({ ok: true, prefill });
  });

  it.each([
    ['null', null],
    ['an array', [{ total_usd: '1' }]],
    ['a string', 'total_usd=1'],
  ])('rejects a prefill that is %s', (_label, input) => {
    expect(parseEnvelopePrefill(input)).toEqual({
      ok: false,
      error: 'prefill must be an object',
    });
  });

  // DocuSign renders any of these as an empty editable tab, with a 200
  it.each([
    ['number', 0.0001],
    ['null', null],
    ['boolean', true],
    ['list', ['1']],
    ['non-text value', { value: 1, locked: true }],
    ['non-boolean lock', { value: '1', locked: 'true' }],
    ['missing value', { locked: true }],
    ['extra key (a misspelt lock)', { value: '1', lock: true }],
    ['locked empty text', { value: '', locked: true }],
    ['locked blank text', { value: '   ', locked: true }],
  ])('rejects a %s value, naming the field', (_label, value) => {
    expect(parseEnvelopePrefill({ total_btc: value })).toEqual({
      ok: false,
      error: 'unsupported value for field "total_btc"',
    });
  });

  it('applies the same name and size rules as a Web Forms prefill', () => {
    expect(parseEnvelopePrefill({ '': 'x' })).toEqual({
      ok: false,
      error: 'invalid field name ""',
    });
    expect(parseEnvelopePrefill({ 'has space': 'x' }).ok).toBe(false);
    const tooMany = Object.fromEntries(
      Array.from({ length: MAX_PREFILL_FIELDS + 1 }, (_, i) => [`t${i}`, 'v']),
    );
    expect(parseEnvelopePrefill(tooMany)).toEqual({
      ok: false,
      error: `prefill has more than ${MAX_PREFILL_FIELDS} fields`,
    });
  });

  it('never lets a __proto__ key touch Object.prototype', () => {
    const accepted = parseEnvelopePrefill(JSON.parse('{"__proto__": "x"}'));
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(Object.getPrototypeOf(accepted.prefill)).toBe(Object.prototype);
      expect(Object.hasOwn(accepted.prefill, '__proto__')).toBe(true);
    }
    expect(({} as { polluted?: string }).polluted).toBeUndefined();
  });
});

describe('assertEnvelopePrefill', () => {
  it('returns the prefill or throws a PrefillError with the reason', () => {
    expect(assertEnvelopePrefill({ a: 'b' })).toEqual({ a: 'b' });
    expect(assertEnvelopePrefill(undefined)).toEqual({});
    expect(() => assertEnvelopePrefill({ a: 1 })).toThrow(PrefillError);
    expect(() => assertEnvelopePrefill({ a: 1 })).toThrow(
      'Invalid prefill: unsupported value for field "a"',
    );
  });
});

describe('parseWebFormPrefill', () => {
  it('treats a missing prefill as empty', () => {
    expect(parseWebFormPrefill(undefined)).toEqual({ ok: true, prefill: {} });
  });

  it('accepts every documented DocuSign value shape', () => {
    const prefill = {
      full_name: 'Jane Signer',
      units: 1000,
      settlement_btc: 0.01268231,
      birth_date: '1980-12-18',
      alerts: ['Funds_withdrawn', 'Account_info_changed'],
      phone_num: { countryCode: '55', nationalNumber: '1133301000' },
      phone_local: { nationalNumber: '5551234' },
    };
    expect(parseWebFormPrefill(prefill)).toEqual({ ok: true, prefill });
  });

  it.each([
    ['null', null],
    ['an array', [{ full_name: 'x' }]],
    ['a string', 'full_name=x'],
    ['a number', 42],
  ])('rejects a prefill that is %s', (_label, input) => {
    expect(parseWebFormPrefill(input)).toEqual({
      ok: false,
      error: 'prefill must be an object',
    });
  });

  it.each([
    ['boolean', true],
    ['null', null],
    ['non-finite number', Number.NaN],
    ['infinite number', Number.POSITIVE_INFINITY],
    ['nested object', { nested: { deeper: 1 } }],
    ['array with non-strings', ['a', 1]],
    ['phone with extra keys', { nationalNumber: '1', extension: '2' }],
    ['phone without nationalNumber', { countryCode: '1' }],
    [
      'phone with non-string countryCode',
      { countryCode: 1, nationalNumber: '2' },
    ],
  ])('rejects a %s value', (_label, value) => {
    expect(parseWebFormPrefill({ field: value })).toEqual({
      ok: false,
      error: 'unsupported value for field "field"',
    });
  });

  it.each(['', 'has space', 'dotted.name', 'a'.repeat(101), '<script>'])(
    'rejects the field name %j',
    name => {
      const result = parseWebFormPrefill({ [name]: 'x' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/^invalid field name /);
      }
    },
  );

  it('truncates a long offending field name in the error', () => {
    const result = parseWebFormPrefill({ ['x'.repeat(500)]: 'v' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        `invalid field name ${JSON.stringify('x'.repeat(100))}`,
      );
    }
  });

  it('caps the number of fields', () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: MAX_PREFILL_FIELDS + 1 }, (_, i) => [`f${i}`, 'v']),
    );
    expect(parseWebFormPrefill(tooMany)).toEqual({
      ok: false,
      error: `prefill has more than ${MAX_PREFILL_FIELDS} fields`,
    });
    const justEnough = Object.fromEntries(
      Array.from({ length: MAX_PREFILL_FIELDS }, (_, i) => [`f${i}`, 'v']),
    );
    expect(parseWebFormPrefill(justEnough).ok).toBe(true);
  });

  it('never lets a __proto__ key touch Object.prototype', () => {
    // A JSON body can carry "__proto__" as an own property; the parsed prefill
    // must keep it as a plain own property and not pollute the prototype.
    const input = JSON.parse(
      '{"__proto__": {"polluted": "yes"}, "full_name": "Jane"}',
    );
    const result = parseWebFormPrefill(input);
    // __proto__'s value is an object, which is not a supported value shape
    expect(result).toEqual({
      ok: false,
      error: 'unsupported value for field "__proto__"',
    });
    expect(({} as { polluted?: string }).polluted).toBeUndefined();

    const stringProto = JSON.parse('{"__proto__": "x"}');
    const accepted = parseWebFormPrefill(stringProto);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(Object.getPrototypeOf(accepted.prefill)).toBe(Object.prototype);
      expect(Object.hasOwn(accepted.prefill, '__proto__')).toBe(true);
      expect(JSON.stringify(accepted.prefill)).toBe('{"__proto__":"x"}');
    }
  });
});

describe('formatPrefillValue', () => {
  it('renders each value shape the way a form would display it', () => {
    expect(formatPrefillValue('Jane')).toBe('Jane');
    expect(formatPrefillValue(1000)).toBe('1000');
    expect(formatPrefillValue(0.01268231)).toBe('0.01268231');
    expect(formatPrefillValue(['a', 'b'])).toBe('a, b');
    expect(formatPrefillValue([])).toBe('');
    expect(
      formatPrefillValue({ countryCode: '55', nationalNumber: '1133301000' }),
    ).toBe('+55 1133301000');
    expect(formatPrefillValue({ nationalNumber: '5551234' })).toBe('5551234');
  });
});
