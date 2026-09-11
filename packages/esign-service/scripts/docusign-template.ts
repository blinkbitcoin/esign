// Creates the template the proxy (envelope) flow needs in the configured
// DocuSign account, through the eSignature API, so a live run never depends
// on a hand-built template. What it contains is src/providers/docusign/template.ts:
// the capability test form PDF, one recipient role named `signer`, Sign Here
// and Date Signed tabs anchored on the PDF text, and the Text tabs
// `reference` + `notes` an envelope prefill can write to.
// Idempotent: an existing template with the same name is reused as it is,
// so a definition change (a new tab) reaches the account only after the old
// fixture is deleted there, or under a new TEMPLATE_NAME.
//   make docusign-template            prints DOCUSIGN_TEMPLATE_ID=<id>
//   make docusign-template WRITE=1    also sets it in .env (left alone when
//                                     the line already lists several ids)
import 'dotenv/config';

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDocuSignClient } from '@blinkbitcoin/esign-node';
import { getConfig } from '../src/providers/docusign/config';
import {
  TEMPLATE_NAME,
  templateDefinition,
  withTemplateId,
} from '../src/providers/docusign/template';

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
    const next = withTemplateId(readFileSync(ENV_FILE, 'utf8'), templateId);
    if (next === null) {
      console.log(
        `left ${ENV_FILE} alone: DOCUSIGN_TEMPLATE_ID already lists several templates; add ${templateId} by hand if wanted`
      );
    } else {
      writeFileSync(ENV_FILE, next);
      console.log(`wrote DOCUSIGN_TEMPLATE_ID to ${ENV_FILE}`);
    }
  }
};

main().catch((error) => {
  console.error('docusign template failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
