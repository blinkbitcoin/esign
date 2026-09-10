# examples/

Integration reference apps — hosts for the packages, not products. The client
demos show the minimal wiring a host app needs per mode (`ESIGN_MODE` /
`VITE_ESIGN_MODE`: proxy, webform, or publicurl - source building, callbacks,
platform URL/token handling); the two in-process server demos here show
shapes a backend can take on `@blinkbitcoin/esign-node`; the third shape,
the whole service, is the published
[`@blinkbitcoin/esign-service`](../packages/esign-service/README.md)
package.

| Example | Hosts |
|---------|-------|
| [`react-native-demo/`](react-native-demo/README.md) | 📱 `@blinkbitcoin/esign-react-native` (React Native 0.86; Maestro end-to-end target) |
| [`react-demo/`](react-demo/README.md) | 🌐 `@blinkbitcoin/esign-react` (Vite) |
| [`mint-only-demo/`](mint-only-demo/README.md) | 🖥️ `@blinkbitcoin/esign-node` from an API you already have: one mutation that mints a locked Web Forms instance (the Blink API shape) |
| [`serverless-handler-demo/`](serverless-handler-demo/README.md) | 🖥️ `@blinkbitcoin/esign-node` as Fetch handlers behind a route handler or edge function (plain Node adapter here) |

Both server demos illustrate the **in-process tier** - your own API mints,
nothing extra is deployed. The **deployable tier** is not an example: it is
the published [`@blinkbitcoin/esign-service`](../packages/esign-service/README.md)
package and its `ghcr.io/blinkbitcoin/esign-service` image, whose targets are
its [Deploy table](../packages/esign-service/README.md#deploy). The two tiers
side by side: [Backend options](../README.md#backend-options).

Proxy and webform modes need the backend running (`make db-up migrate
backend` from the repo root); public-URL mode runs without it. `make help` here fans common targets (`test`, `coverage`,
`typecheck`) out to every example; examples with a `Makefile` are discovered
automatically. The client demos carry coverage floors; the server demos hold
100% like the packages.
