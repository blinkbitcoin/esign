// Checks a live DocuSign configuration end to end without a UI: the JWT
// grant (naming the consent URL when consent was never granted) and a GET of
// the configured Web Form, printing its name, state and the fields it
// exposes. `make docusign-check` (reads .env).
import 'dotenv/config';

import { consentUrl, createDocuSignClient } from '@blinkbitcoin/esign-server';
import { getConfig, validateConfig } from '../src/providers/docusign/config';

const main = async (): Promise<void> => {
  validateConfig();
  const config = getConfig();
  const client = createDocuSignClient(config);
  let token: string;
  try {
    token = await client.getAccessToken();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('consent_required') || message.includes('insufficient_scope')) {
      console.error('consent has not been granted for this integration key. Open, log in, accept:');
      console.error(
        consentUrl(
          config,
          config.returnUrl?.replace(/\/signing\/return$/, '') ?? 'http://localhost:4000'
        )
      );
      process.exit(2);
    }
    throw error;
  }
  console.log(`jwt grant ok (user ${config.userId}, account ${config.accountId})`);

  const url = `${config.webFormsBaseUrl}/accounts/${config.accountId}/forms/${config.webFormId}?state=active`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) {
    console.error(`GET ${url} -> ${response.status}: ${await response.text()}`);
    process.exit(1);
  }
  const form = (await response.json()) as {
    formProperties?: { name?: string };
    formState?: string;
    formMetadata?: { formState?: string; templateId?: string };
    templateId?: string;
    formContent?: { components?: Record<string, unknown> };
  };
  console.log(`web form ${config.webFormId}:`);
  console.log(`  name:     ${form.formProperties?.name ?? '(unknown)'}`);
  console.log(`  state:    ${form.formState ?? form.formMetadata?.formState ?? '(unknown)'}`);
  const templateId = form.templateId ?? form.formMetadata?.templateId;
  if (templateId) {
    console.log(`  template: ${templateId}`);
  }
  const components = form.formContent?.components;
  if (components) {
    console.log(`  fields:   ${Object.keys(components).join(', ')}`);
  }
  console.log('docusign check: ok');
};

main().catch((error) => {
  console.error('docusign check failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
