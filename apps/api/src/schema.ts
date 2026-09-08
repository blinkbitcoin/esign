// GraphQL schema and resolvers: the package's wire layer over this
// service's envelope service.

import { createESignGraphQL } from '@blinkbitcoin/esign-server';
import { envelopeService } from './services';

export const { typeDefs, resolvers } = createESignGraphQL({ envelopes: envelopeService });
