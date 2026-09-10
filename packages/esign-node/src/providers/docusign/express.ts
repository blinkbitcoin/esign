// DocuSign's pages on an Express router: the return-URL bridge real DocuSign
// redirects to, and the mock Web Forms page the mock provider mints onto.
// Mounted by createESignRouter (express.ts); a host composing its own router
// mounts them the same way. `express` is an optional peer: only the
// ./express entry reaches this module.

import type { Router } from 'express';
import { sendSigningPage } from '../../signingPageExpress';
import { renderSigningReturnBridge } from './bridge';
import { mockWebFormFields, renderMockWebFormPage } from './mockWebFormPage';
import type { WebFormPrefill } from './types';

export interface DocuSignPagesOptions {
  // Serve the mock Web Forms page; pass the mock's prefill lookup so the
  // page shows minted values locked (undefined = page off)
  mockPages?: {
    getWebFormPrefill: (instanceId: string) => WebFormPrefill | undefined;
  };
}

// GET /signing/return (always) and GET /signing/mock-webform/:instanceId
// (with mockPages)
export const mountDocuSignPages = (
  router: Router,
  options: DocuSignPagesOptions = {},
): Router => {
  // Return-URL bridge for REAL DocuSign: DocuSign redirects here with
  // ?event=... (it never postMessages); the page forwards the event to the
  // host app in the postMessage protocol the components expect.
  router.get('/signing/return', (req, res) => {
    const rawEvent =
      typeof req.query.event === 'string' ? req.query.event : undefined;
    sendSigningPage(res, nonce => renderSigningReturnBridge(rawEvent, nonce));
  });

  if (options.mockPages) {
    const { getWebFormPrefill } = options.mockPages;

    // The mock Web Forms instance page: minted prefill locked, query-string
    // prefill (public-form style) editable
    router.get('/signing/mock-webform/:instanceId', (req, res) => {
      const fields = mockWebFormFields(
        getWebFormPrefill(req.params.instanceId),
        req.query,
      );
      sendSigningPage(res, nonce =>
        renderMockWebFormPage(req.params.instanceId, nonce, fields),
      );
    });
  }

  return router;
};
