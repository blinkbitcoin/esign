// Which settings in this configuration are demo settings - a mock provider,
// or a provider still pointed at its sandbox hosts.
//
// A description, not a verdict. Whether running against a sandbox is wrong
// depends on what the deployment is for, and this library cannot see that: a
// staging deployment on the sandbox is correct, a production one is a
// mistake, and the two are indistinguishable from here. So this module
// answers what is demo and says nothing about whether that is acceptable.
// The service reports the answer at boot (posture.ts) and ESIGN_STRICT is
// where an operator asks for it to be fatal.
//
// The check is provider-agnostic: the caller says which provider it selected
// and which demo settings that provider still uses (the DocuSign adapter's
// docuSignDemoHostsInUse, say), so this module imports no provider (the
// provider-boundary test enforces it).

export interface DemoConfig {
  // The selected provider's registry name (reported in the message)
  provider: string;
  // The provider itself is a demo/mock provider
  demo?: boolean;
  // Demo hosts the provider is still configured with, as "VAR=value"
  demoHosts?: string[];
}

// Every demo setting in `config`, one message per setting. Empty when the
// deployment is on a real provider and real hosts.
//
// Pure: no environment, no I/O. The same config always describes the same
// way, whatever the deployment claims to be.
export const demoSettings = (config: DemoConfig): string[] => [
  ...(config.demo
    ? [`the ${config.provider} provider is a demo provider`]
    : []),
  ...(config.demoHosts ?? []).map(host => `${host} is a demo host`),
];
