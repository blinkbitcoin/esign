// Tests for the domain tracing helpers: span lifecycle (end/exception/status),
// the provider-boundary wrapper, and the PII discipline (ids and statuses
// only - never recipient data).

import { vi } from 'vitest';

type FakeSpan = {
  setAttribute: ReturnType<typeof vi.fn>;
  setAttributes: ReturnType<typeof vi.fn>;
  recordException: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

const spans: Array<{ name: string; attributes: Record<string, unknown>; span: FakeSpan }> = [];
let activeSpan: FakeSpan | undefined;

const makeSpan = (): FakeSpan => ({
  setAttribute: vi.fn(),
  setAttributes: vi.fn(),
  recordException: vi.fn(),
  setStatus: vi.fn(),
  end: vi.fn(),
});

vi.mock('@opentelemetry/api', () => ({
  SpanStatusCode: { ERROR: 2 },
  trace: {
    getTracer: () => ({
      startActiveSpan: (
        name: string,
        options: { attributes: Record<string, unknown> },
        fn: (span: FakeSpan) => unknown
      ) => {
        const span = makeSpan();
        spans.push({ name, attributes: options.attributes, span });
        return fn(span);
      },
    }),
    getActiveSpan: () => activeSpan,
  },
}));

import type { ESignProvider } from '../src/providers/port';
import {
  instrumentProvider,
  setActiveSpanAttributes,
  withSpan,
  withSpanSync,
} from '../src/tracing';

const recipient = { name: 'Jane Doe', email: 'jane@example.com' };

beforeEach(() => {
  spans.length = 0;
  activeSpan = undefined;
});

describe('withSpan', () => {
  it('returns the result and ends the span', async () => {
    const result = await withSpan('op', { key: 'value' }, async () => 42);

    expect(result).toBe(42);
    expect(spans[0].name).toBe('op');
    expect(spans[0].attributes).toEqual({ key: 'value' });
    expect(spans[0].span.end).toHaveBeenCalledOnce();
    expect(spans[0].span.setStatus).not.toHaveBeenCalled();
  });

  it('records the exception, sets error status, rethrows, and still ends', async () => {
    const failure = new Error('provider down');
    await expect(
      withSpan('op', {}, async () => {
        throw failure;
      })
    ).rejects.toThrow('provider down');

    expect(spans[0].span.recordException).toHaveBeenCalledWith(failure);
    expect(spans[0].span.setStatus).toHaveBeenCalledWith({ code: 2, message: 'provider down' });
    expect(spans[0].span.end).toHaveBeenCalledOnce();
  });

  it('stringifies non-Error throwables', async () => {
    await expect(
      withSpan('op', {}, async () => {
        throw 'raw string';
      })
    ).rejects.toBe('raw string');

    expect(spans[0].span.recordException).toHaveBeenCalledWith('raw string');
    expect(spans[0].span.setStatus).toHaveBeenCalledWith({ code: 2, message: 'raw string' });
  });
});

describe('withSpanSync', () => {
  it('returns the result and ends the span', () => {
    const result = withSpanSync('sync-op', { a: 1 }, () => 'ok');

    expect(result).toBe('ok');
    expect(spans[0].span.end).toHaveBeenCalledOnce();
  });

  it('records exceptions and rethrows', () => {
    expect(() =>
      withSpanSync('sync-op', {}, () => {
        throw new Error('bad payload');
      })
    ).toThrow('bad payload');

    expect(spans[0].span.recordException).toHaveBeenCalled();
    expect(spans[0].span.setStatus).toHaveBeenCalledWith({ code: 2, message: 'bad payload' });
    expect(spans[0].span.end).toHaveBeenCalledOnce();
  });

  it('stringifies non-Error throwables', () => {
    expect(() =>
      withSpanSync('sync-op', {}, () => {
        throw 42;
      })
    ).toThrow();

    expect(spans[0].span.recordException).toHaveBeenCalledWith('42');
  });
});

describe('setActiveSpanAttributes', () => {
  it('sets attributes on the active span', () => {
    activeSpan = makeSpan();
    setActiveSpanAttributes({ 'enduser.id': 'user-1' });
    expect(activeSpan.setAttributes).toHaveBeenCalledWith({ 'enduser.id': 'user-1' });
  });

  it('is a no-op without an active span', () => {
    expect(() => setActiveSpanAttributes({ key: 'v' })).not.toThrow();
  });
});

describe('instrumentProvider', () => {
  const inner: ESignProvider = {
    createEnvelope: vi
      .fn()
      .mockResolvedValue({ envelopeId: 'prov-env-1', signingUrl: 'http://sign' }),
    getEnvelopeStatus: vi.fn().mockResolvedValue('completed'),
    getSigningUrl: vi.fn().mockResolvedValue({ signingUrl: 'http://sign-again' }),
    verifyWebhook: vi.fn().mockReturnValue(true),
    parseWebhookEvent: vi.fn().mockReturnValue(null),
  };
  const wrapped = instrumentProvider(inner, 'mock');

  it('createEnvelope: delegates, tags contract/user, records the provider envelope id', async () => {
    const result = await wrapped.createEnvelope('user-1', 'loan_agreement', recipient);

    expect(result.envelopeId).toBe('prov-env-1');
    expect(inner.createEnvelope).toHaveBeenCalledWith('user-1', 'loan_agreement', recipient);
    expect(spans[0].name).toBe('esign.provider.create_envelope');
    expect(spans[0].attributes).toEqual({
      'esign.provider': 'mock',
      'esign.contract_type': 'loan_agreement',
      'enduser.id': 'user-1',
    });
    expect(spans[0].span.setAttribute).toHaveBeenCalledWith(
      'esign.provider_envelope_id',
      'prov-env-1'
    );
  });

  it('never attaches recipient PII to spans', async () => {
    await wrapped.createEnvelope('user-1', 'loan_agreement', recipient);
    await wrapped.getSigningUrl('prov-env-1', recipient);

    for (const { attributes, span } of spans) {
      const attributeValues = [
        ...Object.values(attributes),
        ...span.setAttribute.mock.calls.map((call) => call[1]),
      ];
      expect(attributeValues).not.toContain('Jane Doe');
      expect(attributeValues).not.toContain('jane@example.com');
    }
  });

  it('getEnvelopeStatus: records the resulting status', async () => {
    await expect(wrapped.getEnvelopeStatus('prov-env-1')).resolves.toBe('completed');
    expect(spans[0].name).toBe('esign.provider.get_envelope_status');
    expect(spans[0].span.setAttribute).toHaveBeenCalledWith('esign.envelope_status', 'completed');
  });

  it('getSigningUrl: delegates under its span', async () => {
    await wrapped.getSigningUrl('prov-env-1', recipient);
    expect(inner.getSigningUrl).toHaveBeenCalledWith('prov-env-1', recipient);
    expect(spans[0].name).toBe('esign.provider.get_signing_url');
    expect(spans[0].attributes['esign.provider_envelope_id']).toBe('prov-env-1');
  });

  it('verifyWebhook: records the verification result', () => {
    expect(wrapped.verifyWebhook({}, 'body', '1.2.3.4')).toBe(true);
    expect(inner.verifyWebhook).toHaveBeenCalledWith({}, 'body', '1.2.3.4');
    expect(spans[0].name).toBe('esign.provider.verify_webhook');
    expect(spans[0].span.setAttribute).toHaveBeenCalledWith('esign.webhook.verified', true);
  });

  it('parseWebhookEvent: flags malformed payloads', () => {
    expect(wrapped.parseWebhookEvent('not json')).toBeNull();
    expect(spans[0].name).toBe('esign.provider.parse_webhook_event');
    expect(spans[0].span.setAttribute).toHaveBeenCalledWith('esign.webhook.malformed', true);
  });

  it('createWebFormInstance: wrapped only when supported, records the instance id', async () => {
    const withWebForms = instrumentProvider(
      {
        ...inner,
        createWebFormInstance: vi.fn().mockResolvedValue({ url: 'http://f', instanceId: 'inst-1' }),
      },
      'mock'
    );
    const result = await withWebForms.createWebFormInstance!('user-1', { full_name: 'Jane' });

    expect(result).toEqual({ url: 'http://f', instanceId: 'inst-1' });
    expect(spans[0].name).toBe('esign.provider.create_webform_instance');
    expect(spans[0].attributes).toEqual({ 'esign.provider': 'mock', 'enduser.id': 'user-1' });
    expect(spans[0].span.setAttribute).toHaveBeenCalledWith('esign.webform_instance_id', 'inst-1');
  });

  it('createWebFormInstance: omits the id attribute when the result has none', async () => {
    const withWebForms = instrumentProvider(
      { ...inner, createWebFormInstance: vi.fn().mockResolvedValue({ url: 'http://f' }) },
      'mock'
    );
    await withWebForms.createWebFormInstance!('user-1', {});
    expect(spans[0].span.setAttribute).not.toHaveBeenCalledWith(
      'esign.webform_instance_id',
      expect.anything()
    );
  });

  it('does not add createWebFormInstance when the inner provider lacks it', () => {
    expect(wrapped.createWebFormInstance).toBeUndefined();
  });
});
