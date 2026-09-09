// The old module paths of everything that moved under docusign/ and
// bridge/ keep exporting the same values (deprecated), so a host importing
// a deep path, and the package's own root entry, see no change.

import * as bridgeScript from '../bridgeScript';
import * as bridge from '../docusign/bridge';
import * as docusignHandlers from '../docusign/handlers';
import * as mockWebFormPage from '../docusign/mockWebFormPage';
import * as docusignPrefill from '../docusign/prefill';
import * as handlers from '../handlers';
import * as index from '../index';
import * as pages from '../pages';
import * as prefill from '../prefill';
import * as script from '../bridge/script';

describe('deprecated module paths', () => {
  it('prefill.ts is docusign/prefill.ts', () => {
    expect(prefill.parseWebFormPrefill).toBe(
      docusignPrefill.parseWebFormPrefill,
    );
    expect(prefill.assertWebFormPrefill).toBe(
      docusignPrefill.assertWebFormPrefill,
    );
    expect(prefill.formatPrefillValue).toBe(docusignPrefill.formatPrefillValue);
    expect(prefill.WebFormPrefillError).toBe(
      docusignPrefill.WebFormPrefillError,
    );
    expect(prefill.MAX_PREFILL_FIELDS).toBe(docusignPrefill.MAX_PREFILL_FIELDS);
  });

  it('bridgeScript.ts is bridge/script.ts plus the DocuSign sessionEnd script', () => {
    expect(bridgeScript.POST_SIGNING_EVENT_SCRIPT).toBe(
      script.POST_SIGNING_EVENT_SCRIPT,
    );
    expect(bridgeScript.POST_SESSION_END_SCRIPT).toBe(
      mockWebFormPage.POST_SESSION_END_SCRIPT,
    );
  });

  it('pages.ts re-exports the bridge, the mock Web Forms page and the client events', () => {
    expect(pages.CLIENT_EVENTS).toBe(script.CLIENT_EVENTS);
    expect(pages.mapDocuSignReturnEvent).toBe(bridge.mapDocuSignReturnEvent);
    expect(pages.renderSigningReturnBridge).toBe(
      bridge.renderSigningReturnBridge,
    );
    expect(pages.LOCKED_FIELDS_HINT).toBe(mockWebFormPage.LOCKED_FIELDS_HINT);
    expect(pages.mockWebFormFields).toBe(mockWebFormPage.mockWebFormFields);
    expect(pages.renderMockWebFormPage).toBe(
      mockWebFormPage.renderMockWebFormPage,
    );
  });

  it('the root entry keeps every moved name and adds the neutral ones', () => {
    expect(index.parseWebFormPrefill).toBe(docusignPrefill.parseWebFormPrefill);
    expect(index.mapDocuSignReturnEvent).toBe(bridge.mapDocuSignReturnEvent);
    expect(index.renderMockWebFormPage).toBe(
      mockWebFormPage.renderMockWebFormPage,
    );
    expect(index.POST_SIGNING_EVENT_SCRIPT).toBe(
      script.POST_SIGNING_EVENT_SCRIPT,
    );
    expect(index.POST_SESSION_END_SCRIPT).toBe(
      mockWebFormPage.POST_SESSION_END_SCRIPT,
    );
    expect(index.mintFromDocuSign).toBe(docusignHandlers.mintFromDocuSign);
    expect(index.createHostedFormInstanceHandler).toBe(
      handlers.createHostedFormInstanceHandler,
    );
    expect(index.renderMockFormPage).toBe(pages.renderMockFormPage);
  });
});
