// Mock for react-native-webview
// Uses a global registry to ensure handler is accessible across module boundaries

import React, { useEffect } from 'react';
import { View } from 'react-native';

interface WebViewProps {
  testID?: string;
  source?: { uri: string };
  onMessage?: (event: { nativeEvent: { data: string } }) => void;
  javaScriptEnabled?: boolean;
  domStorageEnabled?: boolean;
  startInLoadingState?: boolean;
  style?: object;
}

// Use globalThis to ensure handler is accessible across Jest module boundaries
declare global {
  var __webViewMockHandler:
    | ((event: { nativeEvent: { data: string } }) => void)
    | undefined;
}

export const WebView: React.FC<WebViewProps> = ({
  testID,
  source,
  onMessage,
}) => {
  // Store the handler globally so tests can access it
  useEffect(() => {
    globalThis.__webViewMockHandler = onMessage;
    return () => {
      globalThis.__webViewMockHandler = undefined;
    };
  }, [onMessage]);

  return (
    <View
      testID={testID}
      accessibilityLabel={source?.uri}
      accessibilityHint="mock-webview"
    />
  );
};

// Helper for tests to simulate postMessage events
export const simulateWebViewMessage = (data: object) => {
  if (globalThis.__webViewMockHandler) {
    globalThis.__webViewMockHandler({
      nativeEvent: { data: JSON.stringify(data) },
    });
  }
};

// Helper for tests to simulate a raw (non-JSON) postMessage payload, e.g.
// to exercise malformed-message error handling
export const simulateRawWebViewMessage = (rawData: string) => {
  if (globalThis.__webViewMockHandler) {
    globalThis.__webViewMockHandler({
      nativeEvent: { data: rawData },
    });
  }
};

// Reset handler between tests
export const resetWebViewMock = () => {
  globalThis.__webViewMockHandler = undefined;
};

export default WebView;
