// Coded errors come from the package; they carry `extensions.code`, which
// graphql-js copies onto the GraphQL error the client sees.

export type { ErrorCode } from '@blinkbitcoin/esign-server';
export {
  createError,
  ErrorCodes,
  Errors,
  ESignError,
  getErrorCode,
} from '@blinkbitcoin/esign-server';
