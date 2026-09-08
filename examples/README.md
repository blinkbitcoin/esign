# examples/

Integration reference apps — hosts for the packages, not products. The client
demos show the minimal wiring a host app needs per mode (`ESIGN_MODE` /
`VITE_ESIGN_MODE`: proxy, webform, or publicurl - source building, callbacks,
platform URL/token handling); the server demos show the shapes a backend can
take on `@blinkbitcoin/esign-server`.

| Example | Hosts |
|---------|-------|
| [`react-native-demo/`](react-native-demo/README.md) | 📱 `@blinkbitcoin/esign-react-native` (React Native 0.86; Maestro end-to-end target) |
| [`react-demo/`](react-demo/README.md) | 🌐 `@blinkbitcoin/esign-react` (Vite) |
| [`full-service-demo/`](full-service-demo/README.md) | 🖥️ `@blinkbitcoin/esign-server` as a whole service: Express router + Apollo + Postgres store + webhooks (the backend the two client demos and every E2E suite run against; ships as the `esign-api` image) |
| [`mint-only-demo/`](mint-only-demo/README.md) | 🖥️ `@blinkbitcoin/esign-server` from an API you already have: one mutation that mints a locked Web Forms instance (the Blink API shape) |
| [`serverless-handler-demo/`](serverless-handler-demo/README.md) | 🖥️ `@blinkbitcoin/esign-server` as Fetch handlers behind a route handler or edge function (plain Node adapter here) |

Proxy and webform modes need the backend running (`make db-up migrate
backend` from the repo root); public-URL mode runs without it. `make help` here fans common targets (`test`, `coverage`,
`typecheck`) out to every example; examples with a `Makefile` are discovered
automatically. The client demos carry coverage floors; the server demos hold
100% like the packages.
