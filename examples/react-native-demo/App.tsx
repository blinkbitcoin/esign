/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import { ApolloProvider } from '@apollo/client/react';
import { useState } from 'react';
import {
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
  Alert,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { apolloClient } from './src/apollo';
import { ESIGN_MODE, WEBFORM_INSTANCE_URL } from './src/config';
import { HookSigning } from './src/HookSigning';
import {
  ESignature,
  createProxySigningSource,
  type SigningSource,
} from '@blinkbitcoin/esign-react-native';
// Webform mode uses the Apollo-free subpath - dogfoods the minimal entry a
// Web Forms-only consumer would use (see docs/integration/consuming.md)
import { createWebFormsSource } from '@blinkbitcoin/esign-react-native/webform';

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <ApolloProvider client={apolloClient}>
      <SafeAreaProvider>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <AppContent />
      </SafeAreaProvider>
    </ApolloProvider>
  );
}

// Test recipient data for E2E testing
// NOTE: In production, this would come from user input or authentication context
// Hardcoded here for Maestro E2E test compatibility
export const getRecipientData = (): { name: string; email: string } => {
  /* istanbul ignore else -- __DEV__ is hardcoded true by the RN Jest preset; the false branch is a compile-time-only path Metro strips in production */
  if (__DEV__) {
    return { name: 'Test User', email: 'test@example.com' };
  }
  /* istanbul ignore next -- unreachable in tests, see above */
  return { name: '', email: '' };
};

export const handleSigningComplete = (result: {
  envelopeId?: string;
  status: string;
}): void => {
  Alert.alert('Success', `Document signed! Envelope: ${result.envelopeId}`);
};

export const handleSigningError = (error: {
  code: string;
  message: string;
}): void => {
  // Log error for debugging but don't show alert (UI already shows error state)
  console.log('ESignature error:', error.code, error.message);
};

export const handleSigningCancel = (): void => {
  Alert.alert('Cancelled', 'Signing was cancelled.');
};

// Build the signing source for the configured mode (ESIGN_MODE). The component
// and callbacks are identical across modes.
export const buildSource = (): SigningSource => {
  if (ESIGN_MODE === 'webform') {
    const recipient = getRecipientData();
    return createWebFormsSource({
      createInstance: async () => {
        const res = await fetch(WEBFORM_INSTANCE_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer mock-jwt-token',
          },
          body: JSON.stringify({
            prefill: { full_name: recipient.name, email: recipient.email },
          }),
        });
        if (!res.ok) {
          throw new Error(`Could not start signing (HTTP ${res.status})`);
        }
        return res.json();
      },
    });
  }
  return createProxySigningSource({
    client: apolloClient,
    contractType: 'loan_agreement',
    recipient: getRecipientData(),
  });
};

// Two ways to host the flow: the library's default UI (the E2E target) or
// the app's own UI over the useESignature hook (src/HookSigning.tsx)
type UiMode = 'default' | 'hook';

function AppContent() {
  const safeAreaInsets = useSafeAreaInsets();
  const source = buildSource();
  // "Start over" remounts the component (fresh source + idle state). The
  // Maestro flows use it to reset between flows instead of relaunching the
  // app: on iOS a relaunch (terminate + simctl launch) races the XCUITest
  // driver for a few seconds and reloads the dev bundle from Metro.
  const [sessionKey, setSessionKey] = useState(0);
  const [uiMode, setUiMode] = useState<UiMode>('default');

  const signingProps = {
    source,
    onComplete: handleSigningComplete,
    onError: handleSigningError,
    onCancel: handleSigningCancel,
    successDelayMs: 4000,
  };

  return (
    <View style={[styles.container, { paddingTop: safeAreaInsets.top }]}>
      <View style={styles.toolbar}>
        <TouchableOpacity
          onPress={() => setUiMode(m => (m === 'default' ? 'hook' : 'default'))}
          testID="ui-mode-button"
          accessibilityRole="button"
          accessibilityLabel="Toggle signing UI"
        >
          <Text style={styles.toolbarText}>
            {uiMode === 'default' ? 'Use hook UI' : 'Use default UI'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setSessionKey(k => k + 1)}
          testID="reset-button"
          accessibilityRole="button"
          accessibilityLabel="Start over"
        >
          <Text style={styles.toolbarText}>Start over</Text>
        </TouchableOpacity>
      </View>
      {uiMode === 'hook' ? (
        <HookSigning key={sessionKey} {...signingProps} />
      ) : (
        <ESignature key={sessionKey} {...signingProps} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  toolbarText: {
    color: '#007AFF',
    fontSize: 15,
  },
});

export default App;
