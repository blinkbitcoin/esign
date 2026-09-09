import { type AuditMetadata, sanitizeAuditMetadata } from '../audit';

describe('sanitizeAuditMetadata', () => {
  it('returns an empty object when no metadata is given', () => {
    expect(sanitizeAuditMetadata()).toEqual({});
    expect(sanitizeAuditMetadata(undefined)).toEqual({});
  });

  it('keeps every allow-listed key', () => {
    expect(
      sanitizeAuditMetadata({
        contractType: 'nda',
        userId: 'user-1',
        source: 'webhook',
        errorCode: 'PROVIDER_UNAVAILABLE',
      }),
    ).toEqual({
      contractType: 'nda',
      userId: 'user-1',
      source: 'webhook',
      errorCode: 'PROVIDER_UNAVAILABLE',
    });
  });

  it('strips PII and any other key at runtime (security critical)', () => {
    const tainted = {
      contractType: 'nda',
      userId: 'user-1',
      email: 'signer@example.com',
      name: 'Jane Signer',
      recipientEmail: 'signer@example.com',
      documentContent: 'secret clause',
      providerEnvelopeId: 'ds-123',
    } as unknown as AuditMetadata;

    const sanitized = sanitizeAuditMetadata(tainted);

    expect(sanitized).toEqual({ contractType: 'nda', userId: 'user-1' });
    expect(JSON.stringify(sanitized)).not.toContain('signer@example.com');
    expect(JSON.stringify(sanitized)).not.toContain('Jane');
    expect(JSON.stringify(sanitized)).not.toContain('ds-123');
  });

  it('returns a new object, leaving the input alone', () => {
    const input: AuditMetadata = { source: 'api' };
    const sanitized = sanitizeAuditMetadata(input);
    expect(sanitized).toEqual({ source: 'api' });
    expect(sanitized).not.toBe(input);
    expect(sanitizeAuditMetadata({})).toEqual({});
  });
});
