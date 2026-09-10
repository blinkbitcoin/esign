// GraphQL schema and resolvers: the package's wire layer over this
// service's envelope service. A factory, so the resolvers close over the
// envelope service the app built (which closes over the app's provider).

import { createESignGraphQL, type EnvelopeService } from '@blinkbitcoin/esign-node';

export const createGraphQL = (envelopes: EnvelopeService) => createESignGraphQL({ envelopes });
