// The proxy-flow fixture template (what `make docusign-template` creates)
// and the rule for writing its id into .env.

import {
  FIXTURE_TEXT_TABS,
  missingTextTabs,
  TEMPLATE_NAME,
  templateDefinition,
  withTemplateId,
} from '../src/providers/docusign/template';

describe('templateDefinition', () => {
  const definition = templateDefinition('cGRm');
  const signer = definition.recipients.signers[0];

  it('names the fixture, carries the PDF and one role called signer', () => {
    expect(definition.name).toBe(TEMPLATE_NAME);
    expect(definition.documents).toEqual([
      expect.objectContaining({ documentId: '1', documentBase64: 'cGRm' }),
    ]);
    expect(definition.recipients.signers).toHaveLength(1);
    expect(signer).toMatchObject({ roleName: 'signer', recipientId: '1', routingOrder: '1' });
  });

  it('anchors the signing tabs on the PDF text', () => {
    expect(signer.tabs.signHereTabs).toEqual([
      expect.objectContaining({ anchorString: 'Signature:', tabLabel: 'signature' }),
    ]);
    expect(signer.tabs.dateSignedTabs).toEqual([
      expect.objectContaining({ anchorString: 'Date signed:', tabLabel: 'date_signed' }),
    ]);
  });

  // An envelope prefill writes Text tabs only; without these the fixture
  // could not show the feature at all
  it('carries a Text tab per label an envelope prefill can write to', () => {
    const labels = signer.tabs.textTabs.map((tab) => tab.tabLabel);
    expect(labels).toEqual([...FIXTURE_TEXT_TABS]);
    for (const tab of signer.tabs.textTabs) {
      expect(tab).toMatchObject({ documentId: '1', anchorUnits: 'pixels' });
      expect(tab.anchorString).toBeTruthy();
    }
  });
});

// A fixture created before a tab was added keeps the old shape: DocuSign
// answers a prefill for the absent tab with a 200 and drops the value, so
// the live suite fails on an empty document instead of a configuration error
describe('missingTextTabs', () => {
  it('is empty when the account carries every tab of the definition', () => {
    expect(missingTextTabs([...FIXTURE_TEXT_TABS])).toEqual([]);
    expect(missingTextTabs([...FIXTURE_TEXT_TABS, 'a tab an operator added'])).toEqual([]);
  });

  it('names every tab an older fixture lacks, definition order kept', () => {
    expect(missingTextTabs([]).map((tab) => tab.tabLabel)).toEqual([...FIXTURE_TEXT_TABS]);
    expect(missingTextTabs(['signature', 'date_signed']).map((tab) => tab.tabLabel)).toEqual([
      ...FIXTURE_TEXT_TABS,
    ]);
  });

  it('names only the missing one when some are there', () => {
    const [first, second] = FIXTURE_TEXT_TABS;
    expect(missingTextTabs([first]).map((tab) => tab.tabLabel)).toEqual([second]);
    expect(missingTextTabs([second]).map((tab) => tab.tabLabel)).toEqual([first]);
  });

  // What goes back to DocuSign must be a tab definition, not just a label
  it('hands back anchored tab definitions, ready to POST', () => {
    for (const tab of missingTextTabs([])) {
      expect(tab).toMatchObject({ documentId: '1', anchorUnits: 'pixels', width: '300' });
      expect(tab.anchorString).toBeTruthy();
    }
  });
});

describe('withTemplateId', () => {
  const id = 'c4d6e8f0-2a1b-4c3d-9e8f-7a6b5c4d3e2f';

  it('appends the line when the file has none', () => {
    expect(withTemplateId('ESIGN_PROVIDER=docusign\n', id)).toBe(
      `ESIGN_PROVIDER=docusign\nDOCUSIGN_TEMPLATE_ID=${id}\n`
    );
    expect(withTemplateId('', id)).toBe(`\nDOCUSIGN_TEMPLATE_ID=${id}\n`);
  });

  it('replaces a single id in place', () => {
    expect(withTemplateId(`A=1\nDOCUSIGN_TEMPLATE_ID=old-id\nB=2\n`, id)).toBe(
      `A=1\nDOCUSIGN_TEMPLATE_ID=${id}\nB=2\n`
    );
  });

  // A comma-separated list is the operator's multi-document configuration;
  // the fixture must not collapse it to one template
  it('leaves a list of several templates alone', () => {
    expect(withTemplateId('DOCUSIGN_TEMPLATE_ID=tpl-terms,tpl-schedule\n', id)).toBeNull();
    expect(withTemplateId('DOCUSIGN_TEMPLATE_ID=tpl-a, tpl-b\n', id)).toBeNull();
  });
});
