// The GraphQL SDL is the package's (@blinkbitcoin/esign-server); this
// re-export keeps the schema artifact tooling (scripts/emit-schema.ts,
// tests/schema-artifact.test.ts) and client codegen pointed at one source.
export { typeDefs } from '@blinkbitcoin/esign-server';
