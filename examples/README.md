# examples/

Integration reference apps — hosts for the packages, not products. Each shows
the minimal wiring a real host app needs (Apollo client injection, callbacks,
platform URL/token handling).

| Example | Hosts |
|---------|-------|
| [`react-native-demo/`](react-native-demo/README.md) | 📱 `@blinkbitcoin/esign-react-native` (RN 0.86; Maestro E2E target) |
| [`react-demo/`](react-demo/README.md) | 🌐 `@blinkbitcoin/esign-react` (Vite) |

All examples need the backend running: `make db-up migrate backend` from the
repo root. `make help` here fans common targets (`test`, `coverage`,
`typecheck`) out to every example; examples with a `Makefile` are discovered
automatically.
