---
name: docusign-integration-key-setup
description: Use when a DocuSign developer account needs an integration key, RSA keypair, redirect URI or JWT consent for this repo (first live run, a new machine, a new account), or when a JWT grant fails with consent_required / AUTHORIZATION_INSUFFICIENT_SCOPE. Covers doing it through the DocuSign admin UI (incl. with the Claude Chrome extension) without the private key ever leaving the developer's disk.
---

# DocuSign integration key setup (JWT grant)

What the live tooling needs from the DocuSign demo account, and how it was
done on 2026-09-09 for the `esign` app. The private key must never pass
through a chat or a browser page you read: generate the keypair locally and
upload only the public half.

## 1. Generate the keypair locally (never in the DocuSign UI)

```sh
openssl genrsa -out examples/full-service-demo/.docusign.pem 2048
openssl rsa -in examples/full-service-demo/.docusign.pem -pubout -out examples/full-service-demo/.docusign.pub.pem
chmod 600 examples/full-service-demo/.docusign.pem      # *.pem is gitignored
```

The public key (`.docusign.pub.pem`) is safe to print and paste.

## 2. Apps and Keys, in the browser

URLs (the demo environment): `https://admindemo.docusign.com/apps-and-keys`
redirects to `https://apps-d.docusign.com/admin/apps-and-keys`. The app's
own edit page is `.../admin/apps-and-keys/<app-guid>` but deep-linking to it
often hangs on "Loading…" - go through the list page and **Actions → Edit**.
Templates live at `https://apps-d.docusign.com/send/templates` (not
`/templates`, which 404s); a template's id is in its details URL. A web
form's preview is `https://apps-d.docusign.com/send/forms/view/<form-id>`.

1. **Add App and Integration Key** → name it → Create App. Note the
   Integration Key shown on the next page.
2. Integration Type: **Private custom integration**.
3. Service Integration → **Upload RSA** → paste the public key → Upload Key.
   The toast confirms with a keypair id.
4. Additional settings → Redirect URIs → **Add URI** → click into the new
   text box and *type* the URI (setting the value programmatically does not
   register with the form), e.g. `http://localhost:4000`. Press Tab, then
   zoom on the field to confirm the value before saving.
5. **Save** (bottom of the page). Then reopen via Actions → Edit and confirm
   the URI persisted: the consent page answers "There are no redirect URIs
   registered with Docusign" when it is missing, and a first Save right after
   creation has been seen to drop it. Re-add and save again if so.
6. **My Account Information** (collapsed panel on the list page): User ID and
   API Account ID. `find` on the page returns the full GUIDs; screenshots
   truncate them.

## 3. Consent, with the right scopes

The JWT grant asks for `DOCUSIGN_SCOPES` (`packages/esign-server/src/docusign/config.ts`):
`signature impersonation webforms_read webforms_instance_read webforms_instance_write`.
A consent granted for `signature impersonation` alone lets the grant succeed
but every Web Forms call answers 401 `AUTHORIZATION_INSUFFICIENT_SCOPE`.
`make docusign-check` prints the consent URL with the full scope list;
`consentUrl(config, redirectUri)` builds it in code. The consent host
(`account-d.docusign.com`) is outside the Chrome extension's allowed
domains, so the developer opens it themselves. After accepting it redirects
to the registered URI: on this machine another project answers on :4000
(a GraphQL Yoga page), which is harmless - the `code` in the URL is for the
auth-code flow the JWT grant does not use.

## 4. Write the env and verify

```sh
make docusign-env ACCOUNT_ID=… INTEGRATION_KEY=… USER_ID=… TEMPLATE_ID=… WEBFORM_ID=… [PEM=…] [FORCE=1]
make docusign-check
```

`docusign-env` deliberately writes no `JWT_SECRET`: with `ALLOW_INSECURE_DEV`
the bearer token is the user id, which the live specs rely on. The template
id is required by the service config even for Web Forms; the fixture form's
own template is not listed under My Templates, any template works for the
Web Forms path (the proxy envelope live test needs one built for it).

Values used for the `esign` app on 2026-09-09 are recorded in
`examples/full-service-demo/.env` (local only) and in the developer's notes;
the capability test form is `1228ee55-ce36-4b87-8646-39c93d50ee69`
(`docs/integration/webforms.md`).
