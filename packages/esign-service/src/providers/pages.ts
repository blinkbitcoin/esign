// The mock provider's signing pages, as Fetch responses.
//
// They live under providers/ because they speak a provider's vocabulary: the
// mock hosted-form page is DocuSign's Web Forms page, rendered from the mock
// adapter's own prefill lookup - which the caller passes in, so the page
// shows what this app's mint stored. The generic layer (app.ts) asks this
// module for a page and never imports a provider itself.
//
// Real deployments never serve these: they exist so manual testing and the
// E2E suites drive the real WebView/iframe → postMessage path without a
// provider account.

import { renderMockSigningPage, signingPageResponse } from '@blinkbitcoin/esign-node';
import { mockWebFormFields, renderMockWebFormPage } from '@blinkbitcoin/esign-node/docusign';

import type { MockPrefillLookup } from './index';

// The mock envelope signing page (the mock provider's signingUrl points here)
const MOCK_SIGNING_PREFIX = '/signing/mock/';

// The mock hosted-form page (the mock provider's mint points here)
const MOCK_WEBFORM_PREFIX = '/signing/mock-webform/';

// The page for this path, or undefined when the path is not a mock page.
// Minted prefill renders locked; query-string values (the public-form shape)
// render editable.
export const mockPageResponse = (
  url: URL,
  getWebFormPrefill?: MockPrefillLookup
): Response | undefined => {
  const { pathname, searchParams } = url;

  if (pathname.startsWith(MOCK_SIGNING_PREFIX)) {
    const envelopeId = pathname.slice(MOCK_SIGNING_PREFIX.length);
    return signingPageResponse((nonce) => renderMockSigningPage(envelopeId, nonce));
  }

  if (pathname.startsWith(MOCK_WEBFORM_PREFIX)) {
    const instanceId = pathname.slice(MOCK_WEBFORM_PREFIX.length);
    const fields = mockWebFormFields(
      getWebFormPrefill?.(instanceId),
      Object.fromEntries(searchParams)
    );
    return signingPageResponse((nonce) => renderMockWebFormPage(instanceId, nonce, fields));
  }

  return undefined;
};
