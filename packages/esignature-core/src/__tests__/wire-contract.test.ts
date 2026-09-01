/**
 * Wire-contract parity: the package's ErrorCodes map must exactly match the
 * ErrorCode enum generated from apps/api/schema.graphql. If this fails after
 * a schema change, run `npm run codegen` and update ErrorCodes/getErrorMessage.
 */

import { ErrorCodes } from '../client';
import { ErrorCode } from '../generated/error-code';

describe('ErrorCodes wire contract', () => {
  it('matches the schema-generated ErrorCode enum exactly', () => {
    const clientCodes = Object.values(ErrorCodes).sort();
    const schemaCodes = Object.values(ErrorCode).sort();
    expect(clientCodes).toEqual(schemaCodes);
  });
});
