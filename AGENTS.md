# AGENTS.md

Instructions for AI agents working with this codebase.

## Project Overview

React Native sandbox application for experimentation and prototyping.

- **Framework**: React Native 0.83.1
- **React**: 19.2.0
- **Language**: TypeScript
- **Node**: >=20

## Project Structure

```
├── App.tsx              # Main application entry component
├── index.js             # App registry entry point
├── android/             # Android native project
├── ios/                 # iOS native project
├── __tests__/           # Jest test files
├── node_modules/        # Dependencies
└── package.json         # Project configuration
```

## Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start Metro bundler |
| `npm run android` | Run on Android device/emulator |
| `npm run ios` | Run on iOS simulator |
| `npm test` | Run Jest tests |
| `npm run lint` | Run ESLint |

## Code Style

- Use TypeScript for all new files
- Follow existing ESLint and Prettier configurations
- Use functional components with hooks
- Prefer `StyleSheet.create()` for styles

## Architecture Patterns

- **Safe Area**: Use `react-native-safe-area-context` for device notches/edges
- **Dark Mode**: Use `useColorScheme()` hook for theme detection
- **Components**: Keep components in separate files as the app grows

## Testing

- Tests go in `__tests__/` directory
- Use React Test Renderer for component tests
- Run `npm test` before committing

## Adding Dependencies

```bash
npm install <package-name>
# For native dependencies, rebuild:
cd ios && pod install && cd ..
```

## Troubleshooting

- **Metro cache**: `npm start -- --reset-cache`
- **Clean Android build**: `cd android && ./gradlew clean && cd ..`
- **Clean iOS build**: `cd ios && xcodebuild clean && cd ..`
- **Reinstall deps**: `rm -rf node_modules && npm install`
