import { apolloClient, getAuthToken } from '../apollo';

describe('demo apollo wiring', () => {
  it('provides the fixed dev token (backend dev passthrough treats it as userId)', () => {
    expect(getAuthToken()).toBe('mock-jwt-token');
  });

  it('creates the Apollo client via the library factory', () => {
    expect(apolloClient).toBeDefined();
    expect(apolloClient.link).toBeDefined();
    expect(apolloClient.cache).toBeDefined();
  });
});
