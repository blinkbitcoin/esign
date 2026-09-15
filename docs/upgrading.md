# Upgrading

## The posture flags are gone, and the service's variables are renamed

Two changes in one breaking release, because they touch the same files.

**App developers: nothing to do.** No client package changed.

**The five posture flags are removed.** They asked one question - how much
does this deployment matter - five times, and each guarded something the
service cannot actually judge from inside its own process. It now reports
what it does and does not verify at boot, and starts:

| Before | After |
|---|---|
| `ALLOW_INSECURE_DEV=true` | nothing - this is the default. The banner<br>reports the unverified session. |
| `ESIGN_ENV=production` | `ESIGN_STRICT=true` for the refusals;<br>`ESIGN_GRAPHQL_INTROSPECTION=true` for<br>introspection |
| `ESIGN_ALLOW_DEMO=true` | nothing - demo settings are reported, not<br>refused |
| `ESIGN_ALLOW_CLIENT_PREFILL=true` | nothing - set `ESIGN_PREFILL_URL` if your<br>backend should compute the field values |
| `TERMS_ALLOW_INSECURE=true` | nothing - the plaintext rule is gone. Use<br>`https` unless the hop is private. |
| `productionErrors`,<br>`assertProductionConfig`,<br>`ProductionConfigError` | `demoSettings(config)`, which describes<br>and never throws |

**A production deployment should set `ESIGN_STRICT=true`.** That is the whole
migration for anyone who was relying on the old fail-closed behaviour: one
variable in place of five, and the boot error names what to fix.

**The image no longer sets `ESIGN_ENV=production`.** A container that relied
on that for introspection-off or the demo refusals must now say so.

**The service's own variables are `ESIGN_*`.** One convention, and the
endpoint that decides field values is named after what it returns - the API,
the types and the docs all already called those values a prefill:

| Before | After |
|---|---|
| `TERMS_URL`, `TERMS_SHARED_SECRET`,<br>`TERMS_TIMEOUT_MS` | `ESIGN_PREFILL_URL`,<br>`ESIGN_PREFILL_SECRET`,<br>`ESIGN_PREFILL_TIMEOUT_MS` |
| `x-esign-terms-secret` header | `x-esign-prefill-secret` |
| `SESSION_JWKS_URL`,<br>`SESSION_HS256_SECRET`, `JWT_SECRET` | `ESIGN_SESSION_JWKS_URL`,<br>`ESIGN_SESSION_SECRET` (no alias) |
| `SESSION_ISSUER`, `SESSION_AUDIENCE`,<br>`SESSION_USER_CLAIM` | the same with an `ESIGN_` prefix |
| `MOCK_PAGES`, `MOCK_PAGES_ORIGIN`,<br>`TRUST_PROXY`, `RATE_LIMIT_*_PER_MIN`,<br>`CORS_ALLOWED_ORIGINS` | the same with an `ESIGN_` prefix |
| `createTermsPrefill`,<br>`createEnvelopeTerms`, `TermsError`,<br>`termsConfigFromEnv` | `createPrefillHook`,<br>`createEnvelopePrefillHook`,<br>`PrefillError`, `prefillConfigFromEnv` |
| `docs/integration/locked-terms*.md` | `locked-prefill*.md` |

`DOCUSIGN_*`, `DATABASE_URL`, `PORT` and `OTEL_*` are unchanged - they name
other systems.

**New, and worth using:** `node dist/node.js check-session "$TOKEN"` and
`check-prefill` report your configuration line by line, so a wrong issuer or
a wrong callback path is a named line instead of a 401 or a 502.

---

## The 2026-09 stack (PRs #72, #73, #74)

What changed for you then, by audience. Short version: **the public API is additive; nothing you import
today stops working.** The release is a minor version (no commit carries a
breaking-change marker), and the changelog lists the additions.

## Package rename: `esign-server` → `esign-node`

`@blinkbitcoin/esign-server` (`packages/esign-server/`) is renamed
`@blinkbitcoin/esign-node` (`packages/esign-node/`), matching the platform
naming of `esign-react` / `esign-react-native`. No aliases - update every
import from `@blinkbitcoin/esign-server` (and its `/docusign`, `/express`,
`/knex` subpaths) to `@blinkbitcoin/esign-node`. The registry scope in
`.npmrc` (`@blinkbitcoin:registry=...`) is unchanged. The commitlint scope
`server` is renamed `node` in the same change.

## App developers (React Native, React web)

Nothing to do. Every export keeps its name, path and behaviour. New, optional:

| You want | Use |
|---|---|
| Mint a hosted-form instance through your backend without writing the<br>fetch | `createWebFormsSource({ mint: { url, getAuthToken }, prefill })` |
| Mint through your own client (a GraphQL mutation) | `createWebFormsSource({ createInstance })` |
| A provider-neutral hosted-form source | `createHostedFormSource`, `createHostedFormMinter`, `interpretBridgeEvent` |
| The DocuSign adapter on its own | `@blinkbitcoin/esign-core/docusign`, `@blinkbitcoin/esign-react/docusign`,<br>`@blinkbitcoin/esign-react-native/docusign` (all Apollo-free) |
| Completion from a real form in a plain WebView or iframe | nothing: the instance's `returnUrl` and your backend's bridge deliver it<br>([locked-terms.md](integration/locked-terms.md)) |

`@blinkbitcoin/esign-core/webform` and `@blinkbitcoin/esign-react-native/webform`
stay as Apollo-free aliases of the `/docusign` entries.

## Backend developers

`@blinkbitcoin/esign-node` is new. If you ran the service from the repo:

| Before | After |
|---|---|
| `apps/api/` | `examples/full-service-demo/` (same env names, routes, image name<br>`esign-api`) |
| `apps/api/Dockerfile` | `examples/full-service-demo/Dockerfile` (build from the repo root, as<br>before) |
| Provider chosen by a hand-written factory | `providerFromEnv` from the package, keyed by `ESIGN_PROVIDER` (same values) |

Hosts that only need the mint call: [locked-terms.md](integration/locked-terms.md).

## Package promotion: `examples/full-service-demo` → `packages/esign-service`

`examples/full-service-demo/` is renamed `packages/esign-service/` and joins
the publishable set as `@blinkbitcoin/esign-service` (no behaviour change;
same env names, routes, Dockerfile). The image is renamed
`ghcr.io/blinkbitcoin/esign-service` (was `ghcr.io/blinkbitcoin/esign-api`).
The demo is now the service package; the two remaining server examples are
`mint-only-demo` and `serverless-handler-demo`.

## The service becomes one capability-by-env deployable

`@blinkbitcoin/esign-service` no longer assumes a database. Its capabilities
come from the environment: the mint (`POST /webform/instance`,
`GET /signing/return`, `GET /health`) is always on, and `DATABASE_URL` adds
envelope orchestration (`/graphql`, `POST /webhook/esign`, the Knex store).
An existing deployment that sets `DATABASE_URL` keeps every route it had.

| Before | After |
|---|---|
| `node dist/index.js` (image `CMD`) | `node dist/node.js`; migrations are<br>`node dist/node.js migrate` (was<br>`node dist/migrate.js`) |
| `JWT_SECRET` (HS256 only) | `SESSION_JWKS_URL` (RS/ES) or<br>`SESSION_HS256_SECRET`; `JWT_SECRET` stays<br>as an accepted alias |
| Introspection off when<br>`NODE_ENV=production` | Introspection off when<br>`ESIGN_ENV=production`. The image now sets<br>`ESIGN_ENV=production` itself, so a container<br>keeps the strict posture - and refuses the mock<br>provider and demo DocuSign hosts unless<br>`ESIGN_ALLOW_DEMO=true`, and refuses to mint a<br>client's own prefill unless<br>`ESIGN_ALLOW_CLIENT_PREFILL=true`. A non-container<br>deployment that relied on `NODE_ENV` must set<br>`ESIGN_ENV` |
| `DOCUSIGN_HMAC_KEY` required<br>whenever the provider is DocuSign | Required only when envelope orchestration is<br>on (it verifies the webhook) |
| `DOCUSIGN_TEMPLATE_ID` required<br>at provider selection | Required only when envelope orchestration is<br>on; a mint needs `DOCUSIGN_WEBFORM_ID` and<br>`DOCUSIGN_RETURN_URL` instead |
| `validateSecurityConfig()` | `validateConfig(env, { runtime })` - pure,<br>lists every problem plus the capabilities<br>that are on |
| `createApp()` (Express) | `createESignApp(env, deps) → { fetch }`;<br>`startServer(env) → { url, stop }` on<br>`@blinkbitcoin/esign-service/node` |
| Express, helmet, cors,<br>express-rate-limit dependencies | gone: the headers and CORS are in the Fetch<br>core, the rate limits in the Node target |

`TRUST_PROXY` now decides the client address for the webhook's security log
as well as for the rate limits: without it, `x-forwarded-for` is ignored
everywhere (it is a caller-controlled header).

New, optional: `TERMS_URL` (the host computes the prefill actually minted;
its answer wins over client values key by key on the Web Forms mint, and is
minted whole with a required recipient on the envelope mint),
`TERMS_SHARED_SECRET`,
`TERMS_TIMEOUT_MS`, `TERMS_ALLOW_INSECURE` (production requires an https
`TERMS_URL` unless its host is private - loopback, `*.svc`,
`*.svc.cluster.local`, `*.internal` - because the callback carries the
caller's session token and `TERMS_SHARED_SECRET`),
`ESIGN_ALLOW_CLIENT_PREFILL` (production must opt in
before the client's own prefill is minted as sent), `MOCK_PAGES`,
`TRUST_PROXY`, `RATE_LIMIT_{WEBFORM,WEBHOOK,GRAPHQL}_PER_MIN`, and the
`./vercel` / `./cloudflare` entries with the templates in `deploy/`.

Two smaller behaviour changes: `GET /health` now answers
`{ status, capabilities, timestamp }` (the extra field is additive), and
`GET /signing/return?event=a&event=b` takes the first value where Express
treated a repeated parameter as missing.

## Additive since 0.3 (`@blinkbitcoin/esign-node`)

Nothing changes for existing code; these are new exports. Hosts that mint
hosted forms and hand-rolled the boot checks, the mint route or the return
bridge can delete that code.

| You want | Use |
|---|---|
| The whole mint-only HTTP surface on Express (mint + return bridge +<br>health) | `createHostedFormRouter` (`@blinkbitcoin/esign-node/express`) |
| The same surface with no framework, as one Fetch entry point | `createHostedFormApp({ ... }).fetch` |
| Compute the locked terms server-side | the presets' `prefill` hook: it receives the caller's validated<br>prefill and returns the prefill actually minted |
| Reject a request from inside the `prefill` hook (its own input is<br>out of range, say) | throw `Errors.validationError(message)` → `400 { error: message }`,<br>or `Errors.unauthorized()` → `401`; any other error still falls<br>through to `502` |
| The provider a mint needs, checked at boot | `hostedFormProviderFromEnv(env, options?)` - `ESIGN_PROVIDER`,<br>DocuSign by default, `HOSTED_FORM_SETTINGS` required |
| Refuse demo settings in production | `ESIGN_ENV=production` + `productionErrors` /<br>`assertProductionConfig` / `ProductionConfigError`;<br>`ESIGN_ALLOW_DEMO=true` overrides. Never gated on `NODE_ENV` |
| The private key from a mounted secret | `DOCUSIGN_PRIVATE_KEY_BASE64` / `DOCUSIGN_PRIVATE_KEY_FILE`, or<br>`privateKeyFromEnv(env, readFile?)` |
| Know whether a config is still on the DocuSign sandbox | `isDocuSignDemoHost(url)`, `docuSignDemoHostsInUse(config)` |

`docuSignConfigFromEnv(env)` takes an optional second argument
(`{ readFile }`), so the file source is injectable and tests never touch
disk. `defaultRegistry(env, options)` takes `docusign.required`: the
settings that must be present when the DocuSign entry is selected (nothing
by default, so existing hosts are unaffected).

## Additive: the envelope mint

Nothing changes for an existing deployment or host: unset, `ESIGN_MINT_MODE`
is `webform`, and every route answers as before.

`@blinkbitcoin/esign-service`, new, optional: `ESIGN_MINT_MODE` (`webform`,
the default, or `envelope`: `POST /envelope/instance` takes
`{ recipient, prefill }`, creates one envelope from `DOCUSIGN_TEMPLATE_ID`
and answers `{ url, envelopeId }`, served instead of `POST /webform/instance`
and with no database; any other value refuses to start) and
`RATE_LIMIT_ENVELOPE_PER_MIN` (default 60, container only). `TERMS_URL`
applies to the envelope mint too: the callback also receives the client's
`recipient` and may answer the one who signs. `GET /health` now answers
`{ status, capabilities, mint, timestamp }` (the extra field is additive).

`@blinkbitcoin/esign-node`, new exports:

| You want | Use |
|---|---|
| The envelope mint's HTTP decisions, framework-free | `mintEnvelopeInstanceHttp({ userId, body, mint, parsePrefill?,`<br>`logger? })` - `401`, `400` with the reason, `502`,<br>`200 { url, envelopeId }` |
| `POST /envelope/instance` as a Fetch handler | `createEnvelopeInstanceHandler({ provider or mint, authenticate })` |
| The whole envelope mint surface (mint + return bridge + health) | `createEnvelopeApp({ ... }).fetch`; on Express, `createEnvelopeRouter`<br>(`@blinkbitcoin/esign-node/express`, `middleware.envelope`) |
| Decide who signs and what the envelope locks, server-side | the envelope presets' `terms` hook: it receives<br>`{ userId, recipient?, prefill? }` and returns `{ recipient?, prefill? }` |
| The provider an envelope mint needs, checked at boot | `envelopeProviderFromEnv(env, options?)` - `ESIGN_PROVIDER`,<br>DocuSign by default, `ENVELOPE_SETTINGS` required |

Their types are exported too: `EnvelopeAppOptions`, `EnvelopeAppTermsInput`,
`EnvelopeHandlerOptions`, `EnvelopeInstanceHandlerOptions`,
`EnvelopeInstanceResult`, `EnvelopeMintFn`, `EnvelopeMintHttpInput`,
`EnvelopeMintRequest`, `EnvelopeMintTarget`, `EnvelopePrefillParser`,
`EnvelopeTermsHook`, `EnvelopeTermsInput`, `ParsedEnvelopeMintPrefill` and
`EnvelopeProviderOptions`. `ESignRouterMiddleware` gained `envelope`.

## Deprecated names (kept until the next major)

Each carries `@deprecated` JSDoc naming the canonical import; behaviour is
identical. Plan to move at your convenience.

| Deprecated | Canonical |
|---|---|
| `interpretProxyEvent` | `interpretBridgeEvent` |
| `createWebFormInstance?` on `ESignProvider`, `supportsWebForms` | `createHostedFormInstance?`, `supportsHostedForms` |
| `WebFormInstanceOptions`, `WebFormInstanceResult` (server) | `HostedFormInstanceOptions`, `HostedFormInstanceResult` |
| core module paths `signing/events`, `signing/mint`,<br>`signing/webFormsSource`, `signing/publicUrlSource` | `@blinkbitcoin/esign-core/docusign` (DocuSign) or the root (neutral) |
| `packages/esign-react/src/docusignWebForms` module path | `@blinkbitcoin/esign-react/docusign` |
| `packages/esign-node/src/{pages,prefill,bridgeScript}` DocuSign names | `@blinkbitcoin/esign-node/docusign`; `CLIENT_EVENTS` / `ClientEvent` from<br>the root |

Removal happens in a major release, announced in the changelog, after every
in-repo consumer has moved.

## Form owners (DocuSign builder)

Not an API change, but the one rule that decides whether a locked Web Form
can be completed: **read-only fields must be Text or Dropdown fields**; a
read-only Number or Date field makes DocuSign refuse the submission
([docusign-lessons.md](integration/docusign-lessons.md)). Existing forms
with read-only Number or Date fields need a copy with those fields retyped
(field types freeze on activation).
