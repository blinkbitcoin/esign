// Creates the template the proxy (envelope) flow needs in the configured
// DocuSign account, through the eSignature API, so a live run never depends
// on a hand-built template: the capability test form PDF, one recipient
// role named `signer` (what createEnvelopeFromTemplate fills), a Sign Here
// tab anchored on "Signature:" and a Date Signed tab on "Date signed:".
// Idempotent: an existing template with the same name is reused.
//   make docusign-template            prints DOCUSIGN_TEMPLATE_ID=<id>
//   make docusign-template WRITE=1    also sets it in .env
import 'dotenv/config';

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDocuSignClient } from '@blinkbitcoin/esign-node';
import { getConfig } from '../src/providers/docusign/config';

export const TEMPLATE_NAME = 'esign proxy live template (demo fixture)';
const PDF = resolve(__dirname, '../../../docs/assets/esign-capability-test-form.pdf');
const ENV_FILE = resolve(__dirname, '../.env');

const templatesUrl = (): string =>
  `${getConfig().apiBaseUrl}/v2.1/accounts/${getConfig().accountId}/templates`;

const request = async <T>(url: string, init: RequestInit & { token: string }): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${init.token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(
      `${init.method ?? 'GET'} ${url} -> ${response.status}: ${await response.text()}`
    );
  }
  return (await response.json()) as T;
};

export const templateDefinition = (documentBase64: string) => ({
  name: TEMPLATE_NAME,
  description:
    'Created by make docusign-template: the proxy-flow fixture (role signer, Sign Here + Date Signed anchored on the PDF text).',
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
        roleName: 'signer',
        recipientId: '1',
        routingOrder: '1',
        tabs: {
          signHereTabs: [
            {
              documentId: '1',
              anchorString: 'Signature:',
              anchorUnits: 'pixels',
              anchorXOffset: '70',
              anchorYOffset: '-8',
              tabLabel: 'signature',
            },
          ],
          dateSignedTabs: [
            {
              documentId: '1',
              anchorString: 'Date signed:',
              anchorUnits: 'pixels',
              anchorXOffset: '80',
              anchorYOffset: '-2',
              tabLabel: 'date_signed',
            },
          ],
        },
      },
    ],
  },
});

const main = async (): Promise<void> => {
  const token = await createDocuSignClient(getConfig()).getAccessToken();
  const existing = await request<{ envelopeTemplates?: { templateId: string; name: string }[] }>(
    `${templatesUrl()}?search_text=${encodeURIComponent(TEMPLATE_NAME)}`,
    { token }
  );
  let templateId = existing.envelopeTemplates?.find((t) => t.name === TEMPLATE_NAME)?.templateId;
  if (templateId) {
    console.log(`template exists: ${templateId}`);
  } else {
    const created = await request<{ templateId: string }>(templatesUrl(), {
      token,
      method: 'POST',
      body: JSON.stringify(templateDefinition(readFileSync(PDF).toString('base64'))),
    });
    templateId = created.templateId;
    console.log(`template created: ${templateId}`);
  }
  // What reaches .env comes from the API: accept only a DocuSign id (a UUID)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(templateId)) {
    throw new Error(`unexpected template id from DocuSign: ${JSON.stringify(templateId)}`);
  }
  console.log(`DOCUSIGN_TEMPLATE_ID=${templateId}`);
  if (process.env.WRITE) {
    const env = readFileSync(ENV_FILE, 'utf8');
    const next = env.match(/^DOCUSIGN_TEMPLATE_ID=.*$/m)
      ? env.replace(/^DOCUSIGN_TEMPLATE_ID=.*$/m, `DOCUSIGN_TEMPLATE_ID=${templateId}`)
      : `${env.trimEnd()}\nDOCUSIGN_TEMPLATE_ID=${templateId}\n`;
    writeFileSync(ENV_FILE, next);
    console.log(`wrote DOCUSIGN_TEMPLATE_ID to ${ENV_FILE}`);
  }
};

main().catch((error) => {
  console.error('docusign template failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
