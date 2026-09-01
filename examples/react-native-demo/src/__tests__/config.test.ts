import { Platform } from 'react-native';
import { getDevBackendHost, GRAPHQL_URL } from '../config';

describe('getDevBackendHost', () => {
  it('uses the emulator host alias on Android', () => {
    // Android emulators cannot reach the host machine via localhost
    expect(getDevBackendHost('android')).toBe('10.0.2.2');
  });

  it('uses localhost on iOS', () => {
    expect(getDevBackendHost('ios')).toBe('localhost');
  });
});

describe('GRAPHQL_URL', () => {
  it('points at the backend GraphQL endpoint for the current platform', () => {
    expect(GRAPHQL_URL).toBe(
      `http://${getDevBackendHost(Platform.OS)}:4000/graphql`,
    );
  });
});
