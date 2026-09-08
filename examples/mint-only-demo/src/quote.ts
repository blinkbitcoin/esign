// The values the signer must not be able to change are computed here, on the
// server, from the host's own data - a subscription quote in this example.
// They become the prefill of read-only fields; DocuSign locks them.

export interface Quote {
  units: number;
  unitPriceUsd: number;
  btcUsdRate: number;
  quotedAt: Date;
}

// Field API reference names are the form's (docs/integration/webforms.md);
// Number fields carry at most two decimals, so the BTC amount is text.
export const prefillFromQuote = (quote: Quote) => {
  const totalUsd = Math.round(quote.units * quote.unitPriceUsd * 100) / 100;
  return {
    number_of_units: quote.units,
    total_subscription_usd: totalUsd,
    settlement_amount_btc: (totalUsd / quote.btcUsdRate).toFixed(8),
    btc_usd_rate: quote.btcUsdRate,
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
