import { prefillFromQuote, quoteFor } from '../src/quote';

describe('quoteFor', () => {
  it('prices units at the example rate with the time of the quote', () => {
    const now = new Date('2026-09-09T10:00:00Z');
    expect(quoteFor(10, now)).toEqual({
      units: 10,
      unitPriceUsd: 100,
      btcUsdRate: 78_850.5,
      quotedAt: now,
    });
    expect(quoteFor(1).quotedAt).toBeInstanceOf(Date);
  });

  it('rejects anything but a whole number of units in range', () => {
    for (const units of [0, -1, 1.5, 10_001, Number.NaN]) {
      expect(() => quoteFor(units)).toThrow(RangeError);
    }
  });
});

describe('prefillFromQuote', () => {
  it('maps the quote onto the form fields: amounts as text, BTC with eight decimals', () => {
    const prefill = prefillFromQuote(
      quoteFor(1000, new Date('2026-09-09T10:00:00Z')),
    );
    expect(prefill).toEqual({
      number_of_units: '1000',
      total_subscription_usd: '100000.00',
      settlement_amount_btc: '1.26822278',
      btc_usd_rate: '78850.50',
      rate_timestamp: '2026-09-09T10:00:00.000Z',
    });
  });

  it('rounds the USD total to cents', () => {
    const prefill = prefillFromQuote({
      units: 3,
      unitPriceUsd: 33.333,
      btcUsdRate: 50_000,
      quotedAt: new Date(0),
    });
    expect(prefill.total_subscription_usd).toBe('100.00');
  });
});
