// How a Node target reaches the envelope module.
//
// It lives on its own so that only an entry which can actually serve
// envelopes imports it: this is the one place in the package that names
// ./envelopes, and a bundler following an import of this module would pull
// in Apollo and `pg`. The Cloudflare entry must never reach it - the
// import-graph guard in the tests fails if it ever does.

import type { LoadEnvelopes } from './envelopes';

export const loadEnvelopes: LoadEnvelopes = () => import('./envelopes.js');
