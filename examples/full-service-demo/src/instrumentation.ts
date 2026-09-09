// OpenTelemetry tracing bootstrap (house pattern: blink-kyc's
// instrumentation.node.ts), kept maximally generic:
//
// - Configured ONLY through standard OTEL_* environment variables
//   (OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_TRACES_EXPORTER, OTEL_SERVICE_NAME) -
//   works unchanged with any OTLP backend (Honeycomb, Grafana Tempo, Jaeger,
//   a local collector) or `OTEL_TRACES_EXPORTER=console` for local debugging.
// - Off unless configured: no exporter noise in dev/test/CI.
// - No exporter is constructed here - the NodeSDK derives it from the env,
//   so swapping backends is a config change, never a code change.
//
// Must initialize BEFORE express/pg/graphql are loaded (they are patched at
// require time) - index.ts guarantees this ordering.

import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { GraphQLInstrumentation } from '@opentelemetry/instrumentation-graphql';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { NodeSDK } from '@opentelemetry/sdk-node';

type Env = Record<string, string | undefined>;

// Telemetry is opt-in: enabled only when an exporter destination is set
export const isTelemetryConfigured = (env: Env = process.env): boolean =>
  Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT || env.OTEL_TRACES_EXPORTER);

export const initTelemetry = (env: Env = process.env): NodeSDK | null => {
  if (!isTelemetryConfigured(env)) {
    return null;
  }

  const sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME || 'esign-api',
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new GraphQLInstrumentation({ mergeItems: true }),
      new PgInstrumentation(),
      // fetch() goes through undici - HttpInstrumentation does not see it,
      // so DocuSign API calls need this one
      new UndiciInstrumentation(),
    ],
  });

  sdk.start();
  console.log('OpenTelemetry tracing enabled');

  // Flush buffered spans on shutdown
  const shutdown = (): void => {
    sdk
      .shutdown()
      .catch((error: unknown) => console.error('OpenTelemetry shutdown failed:', error));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  return sdk;
};
