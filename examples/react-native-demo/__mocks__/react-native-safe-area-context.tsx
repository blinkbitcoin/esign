// Mock for react-native-safe-area-context
// Renders children immediately with fixed insets (no native measurement pass),
// so components using SafeAreaProvider/useSafeAreaInsets render synchronously in tests.

import React from 'react';

const MOCK_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
const MOCK_FRAME = { x: 0, y: 0, width: 320, height: 640 };

export const SafeAreaProvider: React.FC<{ children?: React.ReactNode }> = ({
  children,
}) => <>{children}</>;

export const useSafeAreaInsets = () => MOCK_INSETS;
export const useSafeAreaFrame = () => MOCK_FRAME;
export const initialWindowMetrics = { insets: MOCK_INSETS, frame: MOCK_FRAME };
