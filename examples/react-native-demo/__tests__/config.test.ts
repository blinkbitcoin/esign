/**
 * @format
 */

import {
  ESIGN_MODE,
  GRAPHQL_URL,
  WEBFORM_INSTANCE_URL,
  getDevBackendHost,
  resolveEsignMode,
} from '../src/config';

describe('config', () => {
  // ESIGN_MODE is inlined by Babel at transform time, so the mode resolver is
  // tested directly rather than by mutating process.env.
  it('resolves the mode, defaulting to proxy', () => {
    expect(resolveEsignMode('webform')).toBe('webform');
    expect(resolveEsignMode('proxy')).toBe('proxy');
    expect(resolveEsignMode('anything-else')).toBe('proxy');
    expect(resolveEsignMode(undefined)).toBe('proxy');
    expect(['proxy', 'webform']).toContain(ESIGN_MODE);
  });

  it('resolves the backend host per platform', () => {
    expect(getDevBackendHost('android')).toBe('10.0.2.2');
    expect(getDevBackendHost('ios')).toBe('localhost');
    expect(GRAPHQL_URL).toBe('http://localhost:4000/graphql');
    expect(WEBFORM_INSTANCE_URL).toBe('http://localhost:4000/webform/instance');
  });
});
