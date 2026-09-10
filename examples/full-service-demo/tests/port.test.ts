// The service's port: PORT wins, else the repo's base port + offset 0.

import { localOrigin, PORT_BASE_DEFAULT, PORT_OFFSET, resolvePort } from '../src/port';

describe('resolvePort', () => {
  it('defaults to the repo base port (offset 0)', () => {
    expect(PORT_OFFSET).toBe(0);
    expect(resolvePort({})).toBe(PORT_BASE_DEFAULT);
    expect(resolvePort({})).toBe(4100);
  });

  it('moves with ESIGN_PORT_BASE', () => {
    expect(resolvePort({ ESIGN_PORT_BASE: '4300' })).toBe(4300);
  });

  it('takes PORT over the base', () => {
    expect(resolvePort({ PORT: '4010', ESIGN_PORT_BASE: '4300' })).toBe(4010);
  });

  it('ignores empty or malformed values', () => {
    expect(resolvePort({ PORT: '', ESIGN_PORT_BASE: 'abc' })).toBe(4100);
    expect(resolvePort({ PORT: '4x' })).toBe(4100);
  });

  it('reads process.env by default', () => {
    const before = process.env.PORT;
    process.env.PORT = '4567';
    try {
      expect(resolvePort()).toBe(4567);
      expect(localOrigin()).toBe('http://localhost:4567');
    } finally {
      if (before === undefined) delete process.env.PORT;
      else process.env.PORT = before;
    }
  });

  it('derives the local origin', () => {
    expect(localOrigin({ ESIGN_PORT_BASE: '4300' })).toBe('http://localhost:4300');
  });
});
