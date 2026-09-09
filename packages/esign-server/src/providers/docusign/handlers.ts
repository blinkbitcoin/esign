// The DocuSign mint target of the framework-neutral handlers: a host with
// no provider object mints straight from a DocuSign config, or from a
// client narrowed to what the mint needs (WebFormsClient).

import type { HostedFormMint } from '../../provider';
import {
  type CreateWebFormInstanceParams,
  createWebFormInstance,
} from './webforms';

// What the DocuSign target of createWebFormInstanceHandler takes
export type DocuSignMintTarget = Pick<
  CreateWebFormInstanceParams,
  'config' | 'client' | 'returnUrl' | 'expirationOffsetHours'
>;

// The mint call for a DocuSign target: createWebFormInstance bound to it
export const mintFromDocuSign =
  (target: DocuSignMintTarget): HostedFormMint =>
  (userId, prefill) =>
    createWebFormInstance({ ...target, userId, prefill });
