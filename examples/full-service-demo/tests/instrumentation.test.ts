// Tests for the OpenTelemetry bootstrap: opt-in gating via standard OTEL_*
// env vars, SDK wiring, and span flushing on shutdown signals.

import { type Mock, vi } from 'vitest';

const sdkStart = vi.fn();
const sdkShutdown = vi.fn();
const nodeSdkConstructor = vi.fn();

vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: class {
    start = sdkStart;
    shutdown = sdkShutdown;
    constructor(config: unknown) {
      nodeSdkConstructor(config);
    }
  },
}));

import { initTelemetry, isTelemetryConfigured } from '../src/instrumentation';

describe('isTelemetryConfigured', () => {
  it('is false with no OTEL exporter configuration', () => {
    expect(isTelemetryConfigured({})).toBe(false);
  });

  it('is true when OTEL_EXPORTER_OTLP_ENDPOINT is set', () => {
    expect(isTelemetryConfigured({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel:4318' })).toBe(true);
  });

  it('is true when OTEL_TRACES_EXPORTER is set (e.g. console for local debug)', () => {
    expect(isTelemetryConfigured({ OTEL_TRACES_EXPORTER: 'console' })).toBe(true);
  });
});

describe('initTelemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'once').mockImplementation(() => process);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a no-op (returns null, starts nothing) when not configured', () => {
    expect(initTelemetry({})).toBeNull();
    expect(sdkStart).not.toHaveBeenCalled();
  });

  it('starts the SDK with the default service name', () => {
    const sdk = initTelemetry({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel:4318' });

    expect(sdk).not.toBeNull();
    expect(sdkStart).toHaveBeenCalledOnce();
    expect(nodeSdkConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: 'esign-api' })
    );
    // The full stack is instrumented: http, express, graphql, pg, undici (fetch)
    const config = nodeSdkConstructor.mock.calls[0][0] as { instrumentations: unknown[] };
    expect(config.instrumentations).toHaveLength(5);
  });

  it('respects OTEL_SERVICE_NAME', () => {
    initTelemetry({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel:4318',
      OTEL_SERVICE_NAME: 'esign-api-staging',
    });

    expect(nodeSdkConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: 'esign-api-staging' })
    );
  });

  it('flushes spans on SIGTERM and SIGINT', async () => {
    sdkShutdown.mockResolvedValue(undefined);
    initTelemetry({ OTEL_TRACES_EXPORTER: 'console' });

    const onceCalls = (process.once as unknown as Mock).mock.calls;
    const signals = onceCalls.map((call) => call[0]);
    expect(signals).toEqual(['SIGTERM', 'SIGINT']);

    const shutdownHandler = onceCalls[0][1] as () => void;
    shutdownHandler();
    expect(sdkShutdown).toHaveBeenCalledOnce();
  });

  it('logs (never throws) when the shutdown flush fails', async () => {
    sdkShutdown.mockRejectedValue(new Error('collector gone'));
    initTelemetry({ OTEL_TRACES_EXPORTER: 'console' });

    const shutdownHandler = (process.once as unknown as Mock).mock.calls[0][1] as () => void;
    shutdownHandler();
    await vi.waitFor(() => {
      expect(console.error).toHaveBeenCalledWith(
        'OpenTelemetry shutdown failed:',
        expect.any(Error)
      );
    });
  });
});
