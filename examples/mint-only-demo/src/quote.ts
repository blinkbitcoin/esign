// The values the signer must not be able to change are computed here, on the
// server, from the host's own data - a subscription quote in this example.
// They become the prefill of read-only fields; DocuSign locks them.

export interface Quote {
  units: number;
  unitPriceUsd: number;
  btcUsdRate: number;
  quotedAt: Date;
}

// Field API reference names are the form's (docs/integration/webforms.md).
// The locked amounts are TEXT fields on the form, so they are sent as
// strings, formatted here once and for all: a read-only NUMBER (or DATE)
// field makes DocuSign refuse the form's submission (422, verified live
// 2026-09-09),
// and a Number field takes at most two decimals anyway - no place for a
// BTC amount. Text also keeps the exact string the signer sees.
export const prefillFromQuote = (quote: Quote) => {
  const totalUsd = Math.round(quote.units * quote.unitPriceUsd * 100) / 100;
  return {
    number_of_units: String(quote.units),
    total_subscription_usd: totalUsd.toFixed(2),
    settlement_amount_btc: (totalUsd / quote.btcUsdRate).toFixed(8),
    btc_usd_rate: quote.btcUsdRate.toFixed(2),
    rate_timestamp: quote.quotedAt.toISOString(),
  };
};

// A host would look this up; the example prices every unit the same
export const quoteFor = (units: number, now = new Date()): Quote => {
  if (!Number.isInteger(units) || units < 1 || units > 10_000) {
    throw new RangeError('units must be an integer between 1 and 10000');
  }
  return { units, unitPriceUsd: 100, btcUsdRate: 78_850.5, quotedAt: now };
};

// The REST spelling (createHostedFormRouter's prefill hook) receives the
// caller's own prefill as intent, not fact: `number_of_units` arrives as
// whatever the client sent (a DocuSign Text-field string, most likely, but
// the contract only guarantees string | number | string[] | phone object).
// This ONLY coerces it to a number - it never validates or rejects
// anything itself (garbage input becomes `NaN`, not a thrown error).
// `quoteFor` is the one place that actually validates the range (and is
// never re-implemented here, so the REST and GraphQL spellings enforce the
// exact same bound); the caller of `unitsFrom` is responsible for turning
// `quoteFor`'s `RangeError` into whatever its own transport expects
// (`src/server.ts` turns it into a `400`, per the REST mint contract).
export const unitsFrom = (prefill: Record<string, unknown>): number =>
  Number(prefill.number_of_units);
