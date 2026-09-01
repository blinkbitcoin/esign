// Mock for @react-native-community/netinfo
// Allows simulating online/offline states in tests

let mockIsConnected = true;
let mockIsInternetReachable: boolean | null = true;

// Helper to simulate network state changes in tests
export const setMockNetworkState = (
  connected: boolean,
  reachable: boolean | null = true,
) => {
  mockIsConnected = connected;
  mockIsInternetReachable = reachable;
};

// Reset to default (online) state
export const resetMockNetworkState = () => {
  mockIsConnected = true;
  mockIsInternetReachable = true;
};

// Mock NetInfo module
const NetInfo = {
  fetch: jest.fn(() =>
    Promise.resolve({
      isConnected: mockIsConnected,
      isInternetReachable: mockIsInternetReachable,
      type: mockIsConnected ? 'wifi' : 'none',
      details: null,
    }),
  ),
  addEventListener: jest.fn(() => {
    // Returns unsubscribe function
    return jest.fn();
  }),
  useNetInfo: jest.fn(() => ({
    isConnected: mockIsConnected,
    isInternetReachable: mockIsInternetReachable,
    type: mockIsConnected ? 'wifi' : 'none',
    details: null,
  })),
  configure: jest.fn(),
  refresh: jest.fn(() =>
    Promise.resolve({
      isConnected: mockIsConnected,
      isInternetReachable: mockIsInternetReachable,
      type: mockIsConnected ? 'wifi' : 'none',
      details: null,
    }),
  ),
};

export default NetInfo;
