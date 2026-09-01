// Presentation: map an error code to a user-friendly message. Kept in the
// component layer (not the sources) - sources produce codes, the UI decides
// wording. Unknown codes fall back to a generic message, so provider-specific
// codes from any source degrade gracefully.

export const getErrorMessage = (
  code: string,
  serverMessage?: string,
): string => {
  switch (code) {
    case 'ENVELOPE_CREATION_FAILED':
      return 'Unable to create signing session. Please try again.';
    case 'VALIDATION_ERROR':
      // Server message is already user-friendly for validation errors
      return serverMessage || 'Invalid input. Please check your information.';
    case 'PERSISTENCE_FAILED':
      return 'Your signing session could not be saved. Please try again.';
    case 'PROVIDER_UNAVAILABLE':
      return 'Signing service temporarily unavailable. Please try again later.';
    case 'SESSION_EXPIRED':
      return 'Session expired, tap to restart';
    case 'UNAUTHORIZED':
      return 'You are not authorized to perform this action.';
    case 'ENVELOPE_NOT_FOUND':
      return 'Signing session not found. Please try again.';
    case 'NETWORK_ERROR':
      return 'Connection lost. Please check your network and try again.';
    default:
      return serverMessage || 'An error occurred. Please try again.';
  }
};
