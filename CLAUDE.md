# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

React Native sandbox application for experimentation and prototyping.

- **Framework**: React Native 0.83.1
- **React**: 19.2.0
- **Language**: TypeScript
- **Node**: >=20

## Commands

```bash
npm start                    # Start Metro bundler
npm run android              # Run on Android device/emulator
npm run ios                  # Run on iOS simulator
npm test                     # Run all Jest tests
npm test -- App.test.tsx     # Run a single test file
npm run lint                 # Run ESLint
```

### iOS Setup (first time or after updating native deps)

```bash
bundle install               # Install CocoaPods via Ruby bundler
bundle exec pod install      # Install iOS dependencies
```

### Troubleshooting

```bash
npm start -- --reset-cache                    # Clear Metro cache
cd android && ./gradlew clean && cd ..        # Clean Android build
cd ios && xcodebuild clean && cd ..           # Clean iOS build
rm -rf node_modules && npm install            # Reinstall dependencies
```

## Code Style

- Use TypeScript for all new files
- Use functional components with hooks
- Prefer `StyleSheet.create()` for styles
- Follow existing ESLint (`@react-native` config) and Prettier configurations

## Architecture Patterns

- **Safe Area**: Use `react-native-safe-area-context` and `useSafeAreaInsets()` for device notches/edges
- **Dark Mode**: Use `useColorScheme()` hook for theme detection
- **Entry Point**: `index.js` registers the app, `App.tsx` is the root component

## Adding Native Dependencies

```bash
npm install <package-name>
cd ios && pod install && cd ..    # Required for native dependencies
```
