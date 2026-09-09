// Emits backend/schema.graphql from the typeDefs SDL (normalized via
// parse+print). The committed file is the schema artifact client packages
// run GraphQL Codegen against; tests/schema-artifact.test.ts fails if it
// drifts from src/schema.ts.
import { writeFileSync } from 'fs';
import { parse, print } from 'graphql';
import { join } from 'path';

import { typeDefs } from '../src/typeDefs';

const sdl = `${print(parse(typeDefs))}\n`;
const outPath = join(__dirname, '..', 'schema.graphql');
writeFileSync(outPath, sdl);
console.log(`schema.graphql written (${sdl.length} bytes)`);
