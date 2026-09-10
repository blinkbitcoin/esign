// The production boot guard: a deployment that says it is production must
// not be running on demo settings - a mock provider, or a provider still
// pointed at its sandbox hosts. The check is provider-agnostic: the caller
// says which provider it selected and which demo settings that provider
// still uses (the DocuSign adapter's docuSignDemoHostsInUse, say), so this
// module imports no provider (the provider-boundary test enforces it).
//
// It gates on ESIGN_ENV alone, never NODE_ENV: NODE_ENV=production is set by
// every Node image and by CI smokes that run the mock on purpose, so it says
// nothing about the e-signature configuration. One explicit override,
// ESIGN_ALLOW_DEMO=true, keeps a production-shaped staging deployment on the
// sandbox possible.

// The variable that declares a deployment production
export const ESIGN_ENV = 'ESIGN_ENV';

// The one bypass: demo settings are allowed in production when it is 'true'
export const ESIGN_ALLOW_DEMO = 'ESIGN_ALLOW_DEMO';

// The value of ESIGN_ENV the guard reacts to
const PRODUCTION = 'production';

export interface ProductionConfig {
  // The selected provider's registry name (reported in the error)
  provider: string;
  // The provider itself is a demo/mock provider
  demo?: boolean;
  // Demo hosts the provider is still configured with, as "VAR=value"
  demoHosts?: string[];
}

// Everything wrong with running `config` as production, one message per
// problem. Empty unless ESIGN_ENV=production, and always empty with
// ESIGN_ALLOW_DEMO=true.
export const productionErrors = (
  env: Record<string, string | undefined>,
  config: ProductionConfig,
): string[] => {
  if (env[ESIGN_ENV] !== PRODUCTION || env[ESIGN_ALLOW_DEMO] === 'true') {
    return [];
  }
  const prefix = `${ESIGN_ENV}=${PRODUCTION}:`;
  return [
    ...(config.demo
      ? [`${prefix} the ${config.provider} provider is a demo provider`]
      : []),
    ...(config.demoHosts ?? []).map(host => `${prefix} ${host} is a demo host`),
  ];
};

// A production deployment configured with demo settings
export class ProductionConfigError extends Error {
  constructor(public readonly errors: string[]) {
    super(
      `${errors.join('; ')}. Set ${ESIGN_ALLOW_DEMO}=true to allow demo settings in production.`,
    );
    this.name = 'ProductionConfigError';
  }
}

// Throw a ProductionConfigError when production is configured with demo
// settings - at selection/boot time, not on the first request
export const assertProductionConfig = (
  env: Record<string, string | undefined>,
  config: ProductionConfig,
): void => {
  const errors = productionErrors(env, config);
  if (errors.length > 0) {
    throw new ProductionConfigError(errors);
  }
};
