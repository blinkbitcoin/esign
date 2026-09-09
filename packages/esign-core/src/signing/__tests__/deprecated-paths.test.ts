// The old signing/* module paths of the DocuSign pieces stay importable
// (deprecated shims over providers/docusign) - and are the same functions.

import * as docusign from '../../providers/docusign';
import { interpretBridgeEvent } from '../bridge';
import * as events from '../events';
import * as mint from '../mint';
import * as publicUrlSource from '../publicUrlSource';
import * as webFormsSource from '../webFormsSource';

describe('deprecated signing/* paths', () => {
  it('signing/events', () => {
    expect(events.interpretDocuSignEvent).toBe(docusign.interpretDocuSignEvent);
    expect(events.interpretBridgeEvent).toBe(interpretBridgeEvent);
    expect(events.interpretProxyEvent).toBe(interpretBridgeEvent);
  });

  it('signing/mint', () => {
    expect(mint.createWebFormsMinter).toBe(docusign.createWebFormsMinter);
  });

  it('signing/webFormsSource', () => {
    expect(webFormsSource.createWebFormsSource).toBe(
      docusign.createWebFormsSource,
    );
    expect(webFormsSource.resolveCreateInstance).toBe(
      docusign.resolveCreateInstance,
    );
  });

  it('signing/publicUrlSource', () => {
    expect(publicUrlSource.createPublicUrlSource).toBe(
      docusign.createPublicUrlSource,
    );
  });
});
