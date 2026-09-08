// Guards the schema artifact and the wire contract:
// 1. backend/schema.graphql must match src/schema.ts (run `npm run schema:emit`)
// 2. the ErrorCode schema enum must match src/errors.ts exactly
import { readFileSync } from 'fs';
import { type EnumTypeDefinitionNode, parse, print } from 'graphql';
import { join } from 'path';
import { ErrorCodes } from '../src/errors';
import { typeDefs } from '../src/typeDefs';

describe('schema.graphql artifact', () => {
  it('matches src/schema.ts (run `npm run schema:emit` after schema changes)', () => {
    const committed = readFileSync(join(__dirname, '..', 'schema.graphql'), 'utf8');
    const expected = `${print(parse(typeDefs))}\n`;
    expect(committed).toBe(expected);
  });
});

describe('ErrorCode wire contract', () => {
  it('the schema enum matches src/errors.ts exactly', () => {
    const doc = parse(typeDefs);
    const enumDef = doc.definitions.find(
      (d): d is EnumTypeDefinitionNode =>
        d.kind === 'EnumTypeDefinition' && d.name.value === 'ErrorCode'
    );
    expect(enumDef).toBeDefined();

    const schemaCodes = (enumDef!.values ?? []).map((v) => v.name.value).sort();
    const errorCodes = Object.values(ErrorCodes).sort();
    expect(schemaCodes).toEqual(errorCodes);
  });
});
