// Tracing port: the domain reports spans through this seam so a host can
// plug OpenTelemetry (or nothing) without the package depending on it.

export interface SpanLike {
  setAttribute(key: string, value: string | number | boolean): void;
}

export type SpanAttributes = Record<string, string | number | boolean>;

export interface Tracing {
  withSpan<T>(
    name: string,
    attributes: SpanAttributes,
    fn: (span: SpanLike) => Promise<T>,
  ): Promise<T>;
}

const noopSpan: SpanLike = { setAttribute: () => undefined };

// Default: no spans, the callback just runs
export const noopTracing: Tracing = {
  withSpan: (_name, _attributes, fn) => fn(noopSpan),
};
