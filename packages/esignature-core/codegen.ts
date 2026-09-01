import type { CodegenConfig } from '@graphql-codegen/cli';

// Generates client types from the backend's emitted schema artifact
// (apps/api/schema.graphql). Run via `npm run codegen` (root) after schema
// changes; parity tests fail if this output drifts.
const config: CodegenConfig = {
  schema: '../../apps/api/schema.graphql',
  documents: ['src/operations.ts'],
  generates: {
    // Operation + input types (typescript-operations v7 is self-contained)
    'src/generated/graphql.ts': {
      plugins: ['typescript-operations'],
    },
    // Schema enums only - the runtime ErrorCode enum (the wire contract)
    'src/generated/error-code.ts': {
      plugins: ['typescript'],
      config: {
        onlyEnums: true,
      },
    },
  },
};

export default config;
