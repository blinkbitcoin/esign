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

  it('takes ESIGN_BACKEND_HOST over the platform default (a physical device)', () => {
    expect(getDevBackendHost('ios', '100.64.0.7')).toBe('100.64.0.7');
    expect(getDevBackendHost('android', 'localhost')).toBe('localhost');
  });

  it('ignores an empty ESIGN_BACKEND_HOST', () => {
    expect(getDevBackendHost('android', '')).toBe('10.0.2.2');
  });
});

describe('GRAPHQL_URL', () => {
  it('points at the backend GraphQL endpoint for the current platform', () => {
    expect(GRAPHQL_URL).toBe(
      `http://${getDevBackendHost(Platform.OS)}:4100/graphql`,
    );
  });
});
