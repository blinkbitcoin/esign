// The one server-side call a host needs for locked (read-only) prefill: mint
// a Web Forms instance for an authenticated user with the values the host
// computed. Everything else about Web Forms (form UI, validation, document,
// signing) needs no server code.

import { createDocuSignClient, type DocuSignClient } from './client';
import { assertDocuSignConfig, type DocuSignConfig } from './config';
import { withRetry, type RetryConfig } from '../http';
import { assertWebFormPrefill } from '../prefill';
import type { WebFormInstanceOptions, WebFormInstanceResult } from '../types';

// What createWebFormInstance needs of a client: its configuration and the
// one request. A host's own client (or a test double) needs nothing more.
export type WebFormsClient = Pick<
  DocuSignClient,
  'config' | 'createWebFormInstanceRequest'
>;

export interface CreateWebFormInstanceParams extends WebFormInstanceOptions {
  // Either a client the host keeps (token cache lives there) ...
  client?: WebFormsClient;
  // ... or a configuration; clients are cached per config object, so a host
  // holding one config object gets one token cache too
  config?: DocuSignConfig;
  // The authenticated user minting the instance (becomes clientUserId, <=100 chars)
  userId: string;
  // Field API reference name → value; validated (WebFormPrefillError otherwise)
  prefill?: unknown;
  retry?: RetryConfig;
}

const clients = new WeakMap<DocuSignConfig, DocuSignClient>();

// The client for a configuration object (created once per object)
export const clientFor = (config: DocuSignConfig): DocuSignClient => {
  let client = clients.get(config);
  if (!client) {
    client = createDocuSignClient(config);
    clients.set(config, client);
  }
  return client;
};

const resolveClient = (params: CreateWebFormInstanceParams): WebFormsClient => {
  if (params.client) {
    return params.client;
  }
  if (params.config) {
    return clientFor(params.config);
  }
  throw new TypeError('createWebFormInstance needs a `client` or a `config`');
};

// DocuSign's clientUserId limit
const CLIENT_USER_ID_MAX = 100;

// Mint a prefilled Web Forms instance. Throws WebFormPrefillError for a bad
// prefill, DocuSignConfigError for missing settings, HttpError after retries.
export const createWebFormInstance = async (
  params: CreateWebFormInstanceParams,
): Promise<WebFormInstanceResult> => {
  const client = resolveClient(params);
  const prefill = assertWebFormPrefill(params.prefill);
  // Fail fast on configuration before any network attempt
  assertDocuSignConfig(client.config, ['accountId', 'webFormId']);
  const clientUserId = params.userId.slice(0, CLIENT_USER_ID_MAX);
  const options: WebFormInstanceOptions = {
    returnUrl: params.returnUrl ?? client.config.returnUrl,
    expirationOffsetHours: params.expirationOffsetHours,
  };
  return withRetry(
    () => client.createWebFormInstanceRequest(clientUserId, prefill, options),
    params.retry,
  );
};
