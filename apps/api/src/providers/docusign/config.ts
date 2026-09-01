// DocuSign configuration from environment variables.

// Configuration from environment variables
export const getConfig = () => {
  const apiBaseUrl = process.env.DOCUSIGN_BASE_URL || 'https://demo.docusign.net/restapi';
  // OAuth endpoint is on a different domain than the API
  const oauthBaseUrl = process.env.DOCUSIGN_OAUTH_URL || 'https://account-d.docusign.com';
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
  const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY;
  const privateKey = process.env.DOCUSIGN_PRIVATE_KEY; // RSA private key in PEM format
  const userId = process.env.DOCUSIGN_USER_ID; // API username (GUID)
  const templateId = process.env.DOCUSIGN_TEMPLATE_ID;
  const returnUrl = process.env.DOCUSIGN_RETURN_URL || 'http://localhost:4000/signing/return';
  // Web Forms API (separate host + product; only needed for Web Forms mode)
  const webFormsBaseUrl =
    process.env.DOCUSIGN_WEBFORMS_BASE_URL || 'https://apps-d.docusign.com/api/webforms/v1.1';
  const webFormId = process.env.DOCUSIGN_WEBFORM_ID;

  return {
    apiBaseUrl,
    oauthBaseUrl,
    accountId,
    integrationKey,
    privateKey,
    userId,
    templateId,
    returnUrl,
    webFormsBaseUrl,
    webFormId,
  };
};

// Validate required environment variables.
// Throws so a misconfigured server fails at startup with a clear message,
// instead of booting fine and crashing deep inside crypto on the first request
// (the code below relies on these values via non-null assertions).
export const validateConfig = (): void => {
  const config = getConfig();
  const missing: string[] = [];

  if (!config.accountId) missing.push('DOCUSIGN_ACCOUNT_ID');
  if (!config.integrationKey) missing.push('DOCUSIGN_INTEGRATION_KEY');
  if (!config.privateKey) missing.push('DOCUSIGN_PRIVATE_KEY');
  if (!config.userId) missing.push('DOCUSIGN_USER_ID');
  if (!config.templateId) missing.push('DOCUSIGN_TEMPLATE_ID');

  if (missing.length > 0) {
    throw new Error(
      `DocuSign provider: Missing required environment variables: ${missing.join(', ')}`
    );
  }
};
