// The ./docusign subpath and the deprecated docusignWebForms path expose the
// same DocuSign.js source as the root (and the subpath is the provider-scoped
// surface: core's DocuSign sources + the neutral layer + the component).

import * as docusign from '@blinkbitcoin/esign-react/docusign';
import * as deprecated from '../docusignWebForms';
import * as root from '../index';
import * as provider from '../providers/docusign';

describe('@blinkbitcoin/esign-react/docusign', () => {
  it('exports the DocuSign provider, the neutral layer and the component', () => {
    expect(docusign.createDocuSignWebFormsSource).toBe(
      provider.createDocuSignWebFormsSource,
    );
    expect(docusign.isMountable).toBe(provider.isMountable);
    expect(docusign.createWebFormsSource).toBe(root.createWebFormsSource);
    expect(docusign.createHostedFormSource).toBe(root.createHostedFormSource);
    expect(docusign.interpretDocuSignEvent).toBe(root.interpretDocuSignEvent);
    expect(docusign.ESignature).toBe(root.ESignature);
    expect(docusign.useESignature).toBe(root.useESignature);
    expect(docusign).not.toHaveProperty('createProxySigningSource');
  });

  it('the deprecated docusignWebForms path is the same source', () => {
    expect(deprecated.createDocuSignWebFormsSource).toBe(
      provider.createDocuSignWebFormsSource,
    );
    expect(deprecated.isMountable).toBe(provider.isMountable);
  });
});
