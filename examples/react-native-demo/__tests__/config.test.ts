/**
 * @format
 */

import {
  ESIGN_MODE,
  GRAPHQL_URL,
  PREFILL_OVERRIDE,
  WEBFORM_INSTANCE_URL,
  getDevBackendHost,
  resolveBackendPort,
  resolveEsignMode,
  resolvePrefillOverride,
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

  it('resolves the backend port, defaulting to 4000', () => {
    expect(resolveBackendPort('4010')).toBe(4010);
    expect(resolveBackendPort('')).toBe(4000);
    expect(resolveBackendPort('abc')).toBe(4000);
    expect(resolveBackendPort(undefined)).toBe(4000);
  });

  it('resolves the prefill override: a JSON object or nothing', () => {
    expect(resolvePrefillOverride(undefined)).toBeUndefined();
    expect(resolvePrefillOverride('')).toBeUndefined();
    expect(resolvePrefillOverride('{"units":"10"}')).toEqual({ units: '10' });
    expect(() => resolvePrefillOverride('[1]')).toThrow('JSON object');
    expect(() => resolvePrefillOverride('null')).toThrow('JSON object');
    expect(() => resolvePrefillOverride('"x"')).toThrow('JSON object');
    expect(PREFILL_OVERRIDE).toBeUndefined();
  });
});
