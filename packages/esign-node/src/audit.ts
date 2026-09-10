// Audit trail vocabulary and its PII guard. Entries never carry email, name
// or document content: metadata is reduced to an allow-list at write time.

export type AuditAction =
  | 'initiated'
  | 'completed'
  | 'failed'
  | 'voided'
  | 'declined'
  | 'session_restart'
  | 'creation_failed';

// Metadata that can be logged (no PII allowed)
export interface AuditMetadata {
  contractType?: string;
  userId?: string;
  source?: 'api' | 'webhook';
  errorCode?: string;
}

const ALLOWED_METADATA_KEYS: ReadonlySet<string> = new Set([
  'contractType',
  'userId',
  'source',
  'errorCode',
]);

// Reduce metadata to the allowed keys (prevents PII leakage at runtime)
export const sanitizeAuditMetadata = (
  metadata?: AuditMetadata,
): Record<string, unknown> => {
  if (!metadata) {
    return {};
  }
  const sanitized: Record<string, unknown> = {};
  for (const key of Object.keys(metadata)) {
    if (ALLOWED_METADATA_KEYS.has(key)) {
      sanitized[key] = (metadata as Record<string, unknown>)[key];
    }
  }
  return sanitized;
};

// A stored audit entry
export interface AuditEntry {
  id: string;
  envelopeId: string;
  action: string;
  timestamp: Date;
  metadata: Record<string, unknown> | null;
}
