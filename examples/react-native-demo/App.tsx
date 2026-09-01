/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import { ApolloProvider } from '@apollo/client/react';
import {
  StatusBar,
  StyleSheet,
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

function AppContent() {
  const safeAreaInsets = useSafeAreaInsets();
  const source = buildSource();

  return (
    <View style={[styles.container, { paddingTop: safeAreaInsets.top }]}>
      <ESignature
        source={source}
        onComplete={handleSigningComplete}
        onError={handleSigningError}
        onCancel={handleSigningCancel}
        successDelayMs={4000}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default App;
