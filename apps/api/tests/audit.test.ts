// Tests for audit logging utility
// Uses a mocked knex client (knex-mock-client) to avoid a real Postgres connection

import type { Tracker } from 'knex-mock-client';
import { createTracker } from 'knex-mock-client';
import { vi } from 'vitest';
import { getAuditLogsByEnvelopeId, logAuditEvent } from '../src/audit';
import { knex } from '../src/db';

describe('Audit Logging', () => {
  let tracker: Tracker;

  beforeAll(() => {
    tracker = createTracker(knex);
  });

  afterEach(() => {
    tracker.reset();
  });

  describe('logAuditEvent', () => {
    it('should create audit log with initiated action', async () => {
      // Arrange
      tracker.on.insert('AuditLog').response([]);

      // Act
      await logAuditEvent('envelope-1', 'initiated', {
        contractType: 'audit_test',
        userId: 'user-audit',
      });

      // Assert
      const insertHistory = tracker.history.insert;
      expect(insertHistory).toHaveLength(1);
      expect(insertHistory[0].bindings).toEqual(
        expect.arrayContaining(['envelope-1', 'initiated'])
      );
    });

    it('should store metadata without PII', async () => {
      // Arrange
      tracker.on.insert('AuditLog').response([]);

      // Act
      await logAuditEvent('envelope-2', 'initiated', {
        contractType: 'meta_contract',
        userId: 'user-meta',
        source: 'api',
      });

      // Assert
      const insertHistory = tracker.history.insert;
      expect(insertHistory).toHaveLength(1);
      const insertedMetadata = JSON.parse(
        insertHistory[0].bindings.find(
          (b): b is string => typeof b === 'string' && b.includes('meta_contract')
        ) as string
      );
      expect(insertedMetadata).toEqual({
        contractType: 'meta_contract',
        userId: 'user-meta',
        source: 'api',
      });
    });

    it('should create audit log with completed action', async () => {
      // Arrange
      tracker.on.insert('AuditLog').response([]);

      // Act
      await logAuditEvent('envelope-3', 'completed', { source: 'webhook' });

      // Assert
      expect(tracker.history.insert).toHaveLength(1);
      expect(tracker.history.insert[0].bindings).toEqual(
        expect.arrayContaining(['envelope-3', 'completed'])
      );
    });

    it('should create audit log with failed action', async () => {
      // Arrange
      tracker.on.insert('AuditLog').response([]);

      // Act
      await logAuditEvent('envelope-4', 'failed');

      // Assert
      expect(tracker.history.insert).toHaveLength(1);
      expect(tracker.history.insert[0].bindings).toEqual(
        expect.arrayContaining(['envelope-4', 'failed'])
      );
    });

    it('should handle empty metadata', async () => {
      // Arrange
      tracker.on.insert('AuditLog').response([]);

      // Act
      await logAuditEvent('envelope-5', 'initiated');

      // Assert
      expect(tracker.history.insert).toHaveLength(1);
      expect(tracker.history.insert[0].bindings).toEqual(
        expect.arrayContaining(['envelope-5', 'initiated', '{}'])
      );
    });

    it('should allow multiple audit logs for same envelope', async () => {
      // Arrange
      tracker.on.insert('AuditLog').response([]);

      // Act
      await logAuditEvent('envelope-6', 'initiated', { source: 'api' });
      await logAuditEvent('envelope-6', 'completed', { source: 'webhook' });

      // Assert
      expect(tracker.history.insert).toHaveLength(2);
      expect(tracker.history.insert[0].bindings).toEqual(
        expect.arrayContaining(['envelope-6', 'initiated'])
      );
      expect(tracker.history.insert[1].bindings).toEqual(
        expect.arrayContaining(['envelope-6', 'completed'])
      );
    });

    // Verify errorCode is preserved in metadata
    it('should preserve errorCode in metadata for failure tracking', async () => {
      // Arrange
      tracker.on.insert('AuditLog').response([]);

      // Act
      await logAuditEvent('envelope-error', 'failed', {
        errorCode: 'PROVIDER_UNAVAILABLE',
        userId: 'user-123',
      });

      // Assert - errorCode should be preserved
      const insertedMetadata = JSON.parse(
        tracker.history.insert[0].bindings.find(
          (b): b is string => typeof b === 'string' && b.includes('PROVIDER_UNAVAILABLE')
        ) as string
      );
      expect(insertedMetadata).toEqual({
        errorCode: 'PROVIDER_UNAVAILABLE',
        userId: 'user-123',
      });
    });

    it('should sanitize metadata and strip PII fields at runtime (security critical)', async () => {
      // Arrange
      tracker.on.insert('AuditLog').response([]);

      // Act - attempt to pass PII via type coercion
      const metadataWithPII = {
        contractType: 'loan',
        userId: 'user-123',
        email: 'sensitive@pii.com', // PII - should be stripped
        recipientName: 'John Doe', // PII - should be stripped
        source: 'api',
      } as unknown;

      await logAuditEvent('envelope-pii', 'initiated', metadataWithPII as { contractType: string });

      // Assert - only allowed fields should be in metadata
      const insertedMetadata = JSON.parse(
        tracker.history.insert[0].bindings.find(
          (b): b is string => typeof b === 'string' && b.includes('contractType')
        ) as string
      );
      expect(insertedMetadata).toEqual({
        contractType: 'loan',
        userId: 'user-123',
        source: 'api',
        // email and recipientName should NOT be present
      });
    });
  });

  // Tests for getAuditLogsByEnvelopeId
  describe('getAuditLogsByEnvelopeId', () => {
    it('should return audit logs for envelope ordered by timestamp desc', async () => {
      // Arrange
      const envelopeId = 'envelope-query-1';
      const mockLogs = [
        {
          id: 'log-3',
          envelopeId,
          action: 'completed',
          timestamp: new Date('2026-02-01T12:00:00Z'),
          metadata: { source: 'webhook' },
        },
        {
          id: 'log-2',
          envelopeId,
          action: 'session_restart',
          timestamp: new Date('2026-02-01T11:00:00Z'),
          metadata: { userId: 'user-123' },
        },
        {
          id: 'log-1',
          envelopeId,
          action: 'initiated',
          timestamp: new Date('2026-02-01T10:00:00Z'),
          metadata: { contractType: 'loan', userId: 'user-123' },
        },
      ];
      tracker.on.select('AuditLog').response(mockLogs);

      // Act
      const result = await getAuditLogsByEnvelopeId(envelopeId);

      // Assert
      expect(tracker.history.select).toHaveLength(1);
      expect(tracker.history.select[0].sql.toLowerCase()).toContain('order by');
      expect(tracker.history.select[0].bindings).toEqual(expect.arrayContaining([envelopeId]));
      expect(result).toHaveLength(3);
      expect(result[0].action).toBe('completed'); // Most recent first
      expect(result[2].action).toBe('initiated'); // Oldest last
    });

    it('should return empty array for envelope with no logs', async () => {
      // Arrange
      tracker.on.select('AuditLog').response([]);

      // Act
      const result = await getAuditLogsByEnvelopeId('envelope-no-logs');

      // Assert
      expect(result).toEqual([]);
    });

    it('should return only logs for specified envelope', async () => {
      // Arrange
      const targetEnvelopeId = 'envelope-specific';
      const mockLogs = [
        {
          id: 'log-specific',
          envelopeId: targetEnvelopeId,
          action: 'initiated',
          timestamp: new Date(),
          metadata: { contractType: 'nda' },
        },
      ];
      tracker.on.select('AuditLog').response(mockLogs);

      // Act
      const result = await getAuditLogsByEnvelopeId(targetEnvelopeId);

      // Assert
      expect(tracker.history.select[0].bindings).toEqual(
        expect.arrayContaining([targetEnvelopeId])
      );
      expect(result).toHaveLength(1);
      expect(result[0].envelopeId).toBe(targetEnvelopeId);
    });

    it('should correctly map metadata from JSON to object', async () => {
      // Arrange
      const mockLogs = [
        {
          id: 'log-metadata',
          envelopeId: 'envelope-meta',
          action: 'initiated',
          timestamp: new Date(),
          metadata: { contractType: 'loan', userId: 'user-456', source: 'api' },
        },
      ];
      tracker.on.select('AuditLog').response(mockLogs);

      // Act
      const result = await getAuditLogsByEnvelopeId('envelope-meta');

      // Assert
      expect(result[0].metadata).toEqual({
        contractType: 'loan',
        userId: 'user-456',
        source: 'api',
      });
    });

    it('should handle null metadata', async () => {
      // Arrange
      const mockLogs = [
        {
          id: 'log-null-meta',
          envelopeId: 'envelope-null',
          action: 'failed',
          timestamp: new Date(),
          metadata: null,
        },
      ];
      tracker.on.select('AuditLog').response(mockLogs);

      // Act
      const result = await getAuditLogsByEnvelopeId('envelope-null');

      // Assert
      expect(result[0].metadata).toBeNull();
    });

    it('should log error and re-throw on database failure', async () => {
      // Arrange
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      tracker.on.select('AuditLog').simulateError('Database connection failed');

      // Act & Assert
      await expect(getAuditLogsByEnvelopeId('envelope-db-error')).rejects.toThrow(
        'Database connection failed'
      );

      // Verify error was logged without PII
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to query audit logs:', {
        envelopeId: 'envelope-db-error',
        error: expect.stringContaining('Database connection failed'),
        timestamp: expect.any(String),
      });

      // Cleanup
      consoleErrorSpy.mockRestore();
    });
  });
});
