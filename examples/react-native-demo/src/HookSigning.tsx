// Hook-driven signing UI: the host owns every button and the WebView, the
// library owns only the state machine (useESignature). This is what an app
// with its own design system would write instead of using <ESignature>.
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import {
  useESignature,
  type UseESignatureOptions,
} from '@blinkbitcoin/esign-react-native';

export const HookSigning = (options: UseESignatureOptions) => {
  const {
    status,
    error,
    isSessionExpired,
    isCheckingConnection,
    sign,
    cancel,
    retry,
    restart,
    checkConnection,
    webViewProps,
  } = useESignature(options);

  if (webViewProps) {
    return (
      <WebView {...webViewProps} style={styles.webview} testID="hook-webview" />
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.status} testID="hook-status">
        {status}
      </Text>
      {status === 'idle' && (
        <>
          <Pressable
            style={styles.primary}
            onPress={sign}
            testID="hook-sign-button"
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>Sign with our own button</Text>
          </Pressable>
          <Pressable
            style={styles.secondary}
            onPress={cancel}
            testID="hook-cancel-button"
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>Not now</Text>
          </Pressable>
        </>
      )}
      {status === 'loading' && <ActivityIndicator color="#F7931A" />}
      {status === 'success' && <Text style={styles.success}>Signed ✓</Text>}
      {status === 'error' && (
        <>
          <Text style={styles.error} testID="hook-error-message">
            {error?.message}
          </Text>
          <Pressable
            style={styles.primary}
            onPress={isSessionExpired ? restart : retry}
            testID="hook-retry-button"
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>
              {isSessionExpired ? 'Restart' : 'Try again'}
            </Text>
          </Pressable>
        </>
      )}
      {status === 'offline' && (
        <Pressable
          style={styles.primary}
          onPress={checkConnection}
          disabled={isCheckingConnection}
          testID="hook-check-connection-button"
          accessibilityRole="button"
        >
          <Text style={styles.primaryText}>
            {isCheckingConnection ? 'Checking…' : 'Reconnect'}
          </Text>
        </Pressable>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  webview: {
    flex: 1,
  },
  status: {
    fontSize: 12,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  primary: {
    backgroundColor: '#F7931A',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 999,
  },
  primaryText: {
    color: '#fff',
    fontWeight: '700',
  },
  secondary: {
    paddingVertical: 10,
  },
  secondaryText: {
    color: '#F7931A',
  },
  success: {
    fontSize: 22,
    color: '#1E7E34',
    fontWeight: '700',
  },
  error: {
    color: '#C82333',
    textAlign: 'center',
  },
});
