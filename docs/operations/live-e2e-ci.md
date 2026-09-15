# Live DocuSign E2E in CI

For whoever operates the repository's GitHub settings. The live suite runs
the same thing a developer runs with `make e2e-live`, against the real
DocuSign demo account: a JWT grant, a real Web Forms instance mint with the
locked values, and a headless browser walking the real capability test form
and tampering with its locked fields. It is opt-in, because every run mints
instances on the demo account and needs a private key that fork PRs must
never see.

The RSA private key is the only secret here. The three GUIDs beside it are
identifiers, useless without it - and masking them costs real
debuggability: a failed grant prints the recovery consent URL (step 3),
which arrives as `client_id=***` when the integration key is a secret.

## What to set up, once

| Where | Name | Value |
|---|---|---|
| Environment `docusign-demo`, secret | `DOCUSIGN_PRIVATE_KEY` | the private half of the app's RSA keypair, the PEM verbatim (multi-line secrets are fine) |
| Environment `docusign-demo`, variable | `DOCUSIGN_INTEGRATION_KEY` | the CI app's integration key (GUID) |
| Environment `docusign-demo`, variable | `DOCUSIGN_USER_ID` | the impersonated user's User ID (GUID) |
| Environment `docusign-demo`, variable | `DOCUSIGN_ACCOUNT_ID` | the API Account ID (GUID) |
| Repository variable | `DOCUSIGN_TEMPLATE_ID` | the proxy-flow template: `make docusign-template` creates it in the account from the fixture PDF and prints the id |
| Repository variable | `DOCUSIGN_WEBFORM_ID` | the capability test form v2: `c640d957-a2d0-4e36-9975-5374afb02b54` |
| Repository variable | `E2E_LIVE` | `true` to run on every main push, release and dispatch; unset or anything else = off |

1. **Create the environment** `docusign-demo` (Settings → Environments). Add
   required reviewers if a human should approve each live run; leave it open
   for unattended runs.
2. **Create a CI integration key** in the DocuSign demo account, separate
   from any developer's: Admin → Apps and Keys → Add App and Integration
   Key, private custom integration, **Upload RSA** with a keypair generated
   on your machine (`openssl genrsa -out ci.pem 2048 && openssl rsa -in ci.pem -pubout`),
   a redirect URI (any, e.g. `http://localhost:4100`). The full click path,
   including the pitfalls, is in
   [docusign-proxy.md](../integration/docusign-proxy.md) and the repo skill
   `.claude/skills/docusign-integration-key-setup`.
3. **Grant consent once**, as the impersonated user, with the Web Forms
   scopes included (a consent for `signature impersonation` alone fails
   every Web Forms call with `AUTHORIZATION_INSUFFICIENT_SCOPE`):

   ```
   https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation%20webforms_read%20webforms_instance_read%20webforms_instance_write&client_id=<INTEGRATION_KEY>&redirect_uri=<REDIRECT_URI>
   ```

   Consent is stored on the DocuSign side; nothing in CI is interactive.
4. **Add the secret and the variables** from the table. Put `ci.pem` in the
   one secret and delete the file.
5. **Turn it on**: `E2E_LIVE=true`, or label a PR `e2e:live` for one run.

## When it runs

- `E2E_LIVE=true`: on every push to `main`, every release run and every
  manual dispatch of `ci.yml`, as the `E2E / Live DocuSign` job.
- PR label `e2e:live`: for that PR, only when its head branch lives in this
  repository. Fork PRs receive no secret, so the label has no effect there.
- Runs are serialized (`concurrency: live-docusign`); one takes about a
  minute. Each run mints two or three Web Forms instances on the demo account
  and nothing else; instances expire on their own.

## What you get

- A green job means: the credentials work, the grant carries the right
  scopes, the form is active, a locked-prefill instance can be minted, in
  a real browser every minted value is displayed and every locked field
  refuses input, the real form renders inside the web component, is
  submitted with its locked terms, signed inside the component and
  completed through the return-URL bridge, and in proxy mode a real
  envelope is created, signed and completed the same way. The job starts
  the E2E Postgres (Docker) for the envelopes, like the Backend job does.
  The React Native counterpart (`make e2e-ios-live`) is local only: it
  needs a booted simulator with the demo installed.
- The form screenshot is uploaded as the `live-docusign-webform` artifact.
  The service log is not uploaded: minted URLs carry a five-minute instance
  token.

## Rotation and revocation

- **Key rotation**: generate a new keypair, upload the public half on the
  integration key (several can coexist), update `DOCUSIGN_PRIVATE_KEY`, then
  remove the old keypair in DocuSign.
- **Revocation**: delete the integration key in DocuSign; the key becomes
  useless immediately, variables and all. Nothing else references them.
- **Consent** is per integration key and user: a new key or a new user
  needs step 3 again. Symptom: `consent_required` on the grant.

## Failure modes

| Job output | Meaning | Fix |
|---|---|---|
| `consent_required` | consent never granted for this key + user | step 3 |
| `AUTHORIZATION_INSUFFICIENT_SCOPE` | consent granted without the `webforms_*` scopes | step 3 with the full URL above |
| `no packages/esign-service/.env … and no DOCUSIGN_* in the environment` | the job ran without the environment's config (wrong environment name, or a fork PR) | check the environment name and the trigger |
| `missing configuration: DOCUSIGN_PRIVATE_KEY` | the variables resolved but the one secret did not (a fork PR, or the environment's secret is gone) | check the environment's secret and the trigger |
| Playwright cannot find the Start button / sees a CAPTCHA | DocuSign challenged the runner's datacenter IP | nothing to fix in the repo; the API half still passed - run the browser half locally (`make e2e-live`) |
| `the form did not advance past …` | the capability test form changed (a new required field) | update the defaults in `scripts/e2e/live.sh` |
| `missing configuration: DOCUSIGN_RETURN_URL` | a demo booted without its own return-URL bridge; the local run hid it | already fixed - `server-demos-smoke.sh` derives each demo's<br>returnUrl from its port; do not re-add it to the job env |

Everything above maps one to one onto the local run, which is the place to
debug: [webforms.md](../integration/webforms.md), section "Live run against
real DocuSign".

The one asymmetry to watch for: locally `live_env` sources
`packages/esign-service/.env` with `set -a`, so every value in that file leaks
into everything the suite starts. In CI the `DOCUSIGN_*` job environment is
exactly what `live_env`'s env-var branch exports and nothing more. A component
that quietly relies on a leaked variable is therefore green locally and red in
CI - so give each process the values it needs explicitly, the way
`live_service_up` and `server-demos-smoke.sh`'s `start` do.
