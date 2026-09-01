# examples/

Integration reference apps — hosts for the packages, not products. Each shows
the minimal wiring a real host app needs per mode (`ESIGN_MODE` /
`VITE_ESIGN_MODE`: proxy, webform, or publicurl - source building, callbacks,
platform URL/token handling).

| Example | Hosts |
|---------|-------|
| [`react-native-demo/`](react-native-demo/README.md) | 📱 `@blinkbitcoin/esign-react-native` (React Native 0.86; Maestro end-to-end target) |
| [`react-demo/`](react-demo/README.md) | 🌐 `@blinkbitcoin/esign-react` (Vite) |

Proxy and webform modes need the backend running (`make db-up migrate
backend` from the repo root); public-URL mode runs without it. `make help` here fans common targets (`test`, `coverage`,
`typecheck`) out to every example; examples with a `Makefile` are discovered
automatically.
