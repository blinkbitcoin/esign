# @blinkbitcoin/esign-server

The server-side half of the e-signature packages: a DocuSign client (JWT
grant, envelopes from a template, Web Forms instances) and the **one call a
backend needs for locked prefill**, `createWebFormInstance`. Node ≥ 18, no
framework, no peers. The esign service (`apps/api`) is built on it; a host
that already has a backend imports it instead of running that service.

## Why a server call at all

DocuSign populates a **read-only** Web Form field only from a
`createInstance` `formValues` payload (or a builder default). That call needs
the integration key's private key, and a locked value is only meaningful when
minted by a party the signer does not control. So the mint runs server-side;
everything else about Web Forms (form UI, validation, document, signing) does
not. Details: [docs/integration/webforms.md](../../docs/integration/webforms.md).

## Use

```ts
import { createWebFormInstance, docuSignConfigFromEnv } from '@blinkbitcoin/esign-server';

// Once, at startup: DOCUSIGN_* env → config (one token cache per config object)
const docusign = docuSignConfigFromEnv();

// Per request, for the authenticated user, with the values you computed
const { url } = await createWebFormInstance({
  config: docusign,
  userId: session.userId,                  // becomes clientUserId
  prefill: {                                // field API reference names → values
    number_of_units: 1000,                  // read-only in the builder → shown locked
    settlement_amount_btc: '0.01268231',    // text field (Number fields take 2 decimals)
    country: 'Sweden',                      // editable in the builder → a suggestion
  },
  returnUrl: 'https://api.example.com/signing/return', // optional; where DocuSign sends the signer after signing
});
// Hand `url` (formUrl#instanceToken=…) to the app right away: the token lives ~5 minutes
```

The prefill is validated before any network call (`WebFormPrefillError`
with the reason), missing settings fail fast (`DocuSignConfigError`), and
transient DocuSign failures (5xx, 429, network) are retried with backoff.

Lower-level pieces, for hosts that need them:

| Export | What |
|---|---|
| `createDocuSignClient(config, { fetch? })` | The client: `createEnvelopeFromTemplate`, `getEmbeddedSigningUrl`, `fetchEnvelopeStatus`, `createWebFormInstanceRequest`, `getAccessToken`, `clearTokenCache` |
| `docuSignConfigFromEnv(env?)`, `DOCUSIGN_ENV`, `assertDocuSignConfig` | Configuration and its `DOCUSIGN_*` mapping (demo-environment URLs by default) |
| `parseWebFormPrefill`, `assertWebFormPrefill`, `formatPrefillValue` | The prefill contract (string, number, string[], phone object) |
| `withRetry`, `HttpError`, `isClientError`, `isNotFoundError` | Retry/backoff and error classification |
| `createTokenProvider`, `createJwtAssertion` | The JWT grant on its own |

## Configuration

| Variable | Setting | Notes |
|---|---|---|
| `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`, `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_PRIVATE_KEY` | JWT grant | consent granted once per integration key |
| `DOCUSIGN_WEBFORM_ID` | Web Forms | the form to mint instances of |
| `DOCUSIGN_TEMPLATE_ID` | envelopes | only for template envelopes |
| `DOCUSIGN_RETURN_URL` | both | default `returnUrl` for instances / signing views |
| `DOCUSIGN_BASE_URL`, `DOCUSIGN_OAUTH_URL`, `DOCUSIGN_WEBFORMS_BASE_URL` | hosts | default to the developer (demo) environment |

## Development (in this monorepo)

```sh
make test        # Jest, 100% coverage enforced
make build       # tsup (ESM + CJS + types)
```
