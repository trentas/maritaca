/**
 * Error handling utilities for Maritaca
 *
 * Provides classification of errors as fatal (non-retryable) vs transient (retryable).
 * Fatal errors should not be retried as they will never succeed.
 */

/**
 * Error codes that indicate a fatal/permanent failure.
 * These errors should NOT be retried as retrying will not help.
 *
 * Organized by provider for easy maintenance.
 */
export const FATAL_ERROR_CODES: ReadonlySet<string> = new Set([
  // ============================================================================
  // Telegram
  // ============================================================================
  'TELEGRAM_NOT_FOUND',        // Chat/user does not exist
  'TELEGRAM_FORBIDDEN',        // Bot was blocked by user or kicked from chat
  'TELEGRAM_UNAUTHORIZED',     // Invalid bot token
  'TELEGRAM_BAD_REQUEST',      // Malformed request (won't be fixed by retry)

  // ============================================================================
  // Slack
  // ============================================================================
  'channel_not_found',         // Channel does not exist
  'user_not_found',            // User does not exist
  'not_in_channel',            // Bot not in the channel
  'is_archived',               // Channel is archived
  'invalid_auth',              // Invalid token
  'account_inactive',          // User account is deactivated
  'token_revoked',             // Token has been revoked
  'no_permission',             // Bot lacks required permissions
  'missing_scope',             // Token missing required OAuth scope
  'SLACK_API_ERROR',           // Generic Slack API error (usually permanent)
  'MISSING_TOKEN',             // No token configured
  'NO_VALID_RECIPIENTS',       // No valid recipients could be resolved

  // ============================================================================
  // Email (Resend)
  // ============================================================================
  'validation_error',          // Invalid email format
  'invalid_from_address',      // From address not verified
  'not_found',                 // Resource not found

  // ============================================================================
  // Email (SES)
  // ============================================================================
  'MessageRejected',           // Email rejected (unverified sender, etc.)
  'InvalidParameterValue',     // Invalid parameter
  'ValidationError',           // Validation failed

  // ============================================================================
  // SMS (SNS)
  // ============================================================================
  'InvalidParameter',          // Invalid phone number format
  'InvalidParameterValue',     // Invalid parameter value
  'ValidationError',           // Validation error

  // ============================================================================
  // Push (SNS)
  // ============================================================================
  'EndpointDisabled',          // Push endpoint is disabled
  'InvalidParameter',          // Invalid endpoint ARN
  'PlatformApplicationDisabled', // Platform app is disabled

  // ============================================================================
  // Web Push
  // ============================================================================
  '404',                       // Subscription not found
  '410',                       // Subscription expired (Gone)

  // ============================================================================
  // Twilio (SMS/WhatsApp)
  // ============================================================================
  '21211',                     // Invalid phone number
  '21214',                     // Invalid destination number
  '21217',                     // Phone number not SMS capable
  '21219',                     // Phone number not WhatsApp capable
  '21408',                     // Permission denied
  '21610',                     // Unsubscribed recipient (opted out)
  '21612',                     // Channel not enabled
  '21614',                     // Invalid WhatsApp number
  '63007',                     // WhatsApp: User not on WhatsApp
  '63016',                     // WhatsApp: Template not approved

  // ============================================================================
  // Generic
  // ============================================================================
  'INVALID_RECIPIENT',         // Generic invalid recipient
  'INVALID_CONFIGURATION',     // Provider not configured correctly
])

/**
 * HTTP status codes that indicate a fatal/permanent failure.
 */
export const FATAL_HTTP_STATUS_CODES: ReadonlySet<number> = new Set([
  400, // Bad Request - malformed request
  401, // Unauthorized - invalid credentials
  403, // Forbidden - no permission
  404, // Not Found - resource doesn't exist
  410, // Gone - resource permanently removed
  422, // Unprocessable Entity - validation failed
])

/**
 * Provider error structure
 */
export interface ProviderError {
  code?: string
  message: string
  details?: Record<string, any>
}

/**
 * Check if an error code indicates a fatal (non-retryable) error.
 *
 * @param errorCode - The error code from the provider
 * @returns true if the error is fatal and should not be retried
 */
export function isFatalErrorCode(errorCode: string | undefined | null): boolean {
  if (!errorCode) {
    return false
  }
  return FATAL_ERROR_CODES.has(errorCode)
}

/**
 * Check if an HTTP status code indicates a fatal (non-retryable) error.
 *
 * @param statusCode - The HTTP status code
 * @returns true if the status indicates a fatal error
 */
export function isFatalHttpStatus(statusCode: number | undefined | null): boolean {
  if (!statusCode) {
    return false
  }
  return FATAL_HTTP_STATUS_CODES.has(statusCode)
}

/**
 * Check if a provider error is fatal (non-retryable).
 *
 * @param error - The provider error object
 * @returns true if the error is fatal and should not be retried
 */
export function isFatalProviderError(error: ProviderError | undefined | null): boolean {
  if (!error) {
    return false
  }

  // Check error code
  if (isFatalErrorCode(error.code)) {
    return true
  }

  // Check for HTTP status in details
  const statusCode = error.details?.statusCode || error.details?.status
  if (statusCode && isFatalHttpStatus(statusCode)) {
    return true
  }

  // Check for Twilio error codes (numeric)
  const twilioCode = error.details?.twilioCode
  if (twilioCode && isFatalErrorCode(String(twilioCode))) {
    return true
  }

  return false
}

/**
 * Wrapper class for fatal errors.
 * When thrown, this signals to the job processor that the error should not be retried.
 */
export class FatalError extends Error {
  public readonly isFatal = true
  public readonly originalError?: Error
  public readonly errorCode?: string

  constructor(message: string, options?: { cause?: Error; code?: string }) {
    super(message)
    this.name = 'FatalError'
    this.originalError = options?.cause
    this.errorCode = options?.code
    
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FatalError)
    }
  }
}

/**
 * Check if an error is a FatalError instance.
 */
export function isFatalError(error: unknown): error is FatalError {
  return error instanceof FatalError || (error as any)?.isFatal === true
}
