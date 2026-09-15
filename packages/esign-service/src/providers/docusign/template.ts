// The proxy-flow fixture template, as `make docusign-template` creates it in
// the configured DocuSign account (scripts/docusign-template.ts): the
// capability test form PDF, one recipient role named `signer` (the default
// DOCUSIGN_SIGNER_ROLE), a Sign Here and a Date Signed tab anchored on the
// PDF's text, and two Text tabs an envelope prefill can write to.
//
// Only Text tabs take a prefill value: DocuSign matches a template-role tab
// value by type + label, so a label naming a Number, Date or List tab is
// ignored with a 200 and an empty, editable field.

export const TEMPLATE_NAME = 'esign proxy live template (demo fixture)';

// The Text tabs the fixture carries, by label: `reference` sits under the
// PDF's locked-terms section (the locked prefill demo), `notes` under the
// optional one (an editable prefill)
export const FIXTURE_TEXT_TABS = ['reference', 'notes'] as const;

// The role the fixture's one recipient carries (the default
// DOCUSIGN_SIGNER_ROLE): what an envelope from this template fills
export const FIXTURE_SIGNER_ROLE = 'signer';

// One tab anchored on a label the PDF prints, placed to its right
const anchored = (anchorString: string, tabLabel: string, xOffset: string, yOffset: string) => ({
  documentId: '1',
  anchorString,
  anchorUnits: 'pixels',
  anchorXOffset: xOffset,
  anchorYOffset: yOffset,
  tabLabel,
});

// The two Text tabs as the template API wants them, anchored on the PDF's
// own labels
export const FIXTURE_TEXT_TAB_DEFINITIONS = [
  { ...anchored('Reference', FIXTURE_TEXT_TABS[0], '120', '-2'), width: '300' },
  { ...anchored('Notes', FIXTURE_TEXT_TABS[1], '120', '-2'), width: '300' },
];

// What an existing fixture in the account is missing, given the Text tab
// labels it carries: a template created before a tab was added to the
// definition keeps the account on the old shape, and the envelope prefill
// then writes to a tab that is not there (DocuSign answers 200 and drops the
// value). `make docusign-template` adds these back.
export const missingTextTabs = (present: readonly string[]): typeof FIXTURE_TEXT_TAB_DEFINITIONS =>
  FIXTURE_TEXT_TAB_DEFINITIONS.filter((tab) => !present.includes(tab.tabLabel));

export const templateDefinition = (documentBase64: string) => ({
  name: TEMPLATE_NAME,
  description:
    'Created by make docusign-template: the proxy-flow fixture (role signer, Sign Here + Date Signed anchored on the PDF text, Text tabs reference + notes for the envelope prefill).',
  emailSubject: 'esign live test: please sign',
  shared: false,
  status: 'created',
  documents: [
    {
      documentId: '1',
      name: 'esign-capability-test-form.pdf',
      fileExtension: 'pdf',
      documentBase64,
    },
  ],
  recipients: {
    signers: [
      {
        roleName: FIXTURE_SIGNER_ROLE,
        recipientId: '1',
        routingOrder: '1',
        tabs: {
          signHereTabs: [anchored('Signature:', 'signature', '70', '-8')],
          dateSignedTabs: [anchored('Date signed:', 'date_signed', '80', '-2')],
          textTabs: FIXTURE_TEXT_TAB_DEFINITIONS,
        },
      },
    ],
  },
});

const TEMPLATE_ID_LINE = /^DOCUSIGN_TEMPLATE_ID=.*$/m;

// The .env contents with DOCUSIGN_TEMPLATE_ID set to the fixture's id: the
// line replaced, or appended when absent. `null` when the existing line
// already lists several templates - that list is the operator's, and the
// fixture must not collapse it to one document.
export const withTemplateId = (env: string, templateId: string): string | null => {
  const existing = env.match(TEMPLATE_ID_LINE);
  if (existing?.[0].includes(',')) {
    return null;
  }
  return existing
    ? env.replace(TEMPLATE_ID_LINE, `DOCUSIGN_TEMPLATE_ID=${templateId}`)
    : `${env.trimEnd()}\nDOCUSIGN_TEMPLATE_ID=${templateId}\n`;
};
