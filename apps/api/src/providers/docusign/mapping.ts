// DocuSign ↔ internal status mapping and Connect webhook payload shape.

import type { EnvelopeStatus } from '../../types';

// Map a DocuSign envelope status (from status polling) to our EnvelopeStatus.
export const mapDocuSignStatus = (status: string): EnvelopeStatus => {
  switch (status.toLowerCase()) {
    case 'sent':
    case 'delivered':
      return 'sent';
    case 'completed':
    case 'signed':
      return 'completed';
    case 'voided':
      return 'voided';
    case 'declined':
      return 'declined';
    default:
      // Default to 'sent' for unknown statuses
      return 'sent';
  }
};

// DocuSign Connect webhook payload structure (per DocuSign Connect docs).
export interface DocuSignWebhookPayload {
  event: string; // e.g. "envelope-completed", "envelope-declined", "envelope-voided"
  apiVersion: string;
  uri: string;
  retryCount: number;
  configurationId: number;
  generatedDateTime: string;
  data: {
    accountId: string;
    userId: string;
    envelopeId: string; // DocuSign's envelope ID (maps to our provider envelope ID)
    envelopeSummary: {
      status: string; // "completed", "declined", "voided", "sent", etc.
      emailSubject: string;
    };
  };
}

// Map DocuSign webhook status strings to internal status values.
// Unknown statuses map to null and the webhook is ignored - unlike the
// status-poll mapping above, which defaults unknowns to 'sent'.
export const mapWebhookStatus = (docusignStatus: string): EnvelopeStatus | null => {
  const statusMap: Record<string, EnvelopeStatus> = {
    completed: 'completed',
    declined: 'declined',
    voided: 'voided',
    sent: 'sent',
  };
  return statusMap[docusignStatus.toLowerCase()] || null;
};
