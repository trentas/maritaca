import { describe, it, expect } from 'vitest'
import {
  isFatalErrorCode,
  isFatalHttpStatus,
  isFatalProviderError,
  FatalError,
  isFatalError,
  FATAL_ERROR_CODES,
  FATAL_HTTP_STATUS_CODES,
} from '../../errors/index.js'

describe('Fatal Error Detection', () => {
  describe('isFatalErrorCode', () => {
    it('should return true for Telegram fatal errors', () => {
      expect(isFatalErrorCode('TELEGRAM_NOT_FOUND')).toBe(true)
      expect(isFatalErrorCode('TELEGRAM_FORBIDDEN')).toBe(true)
      expect(isFatalErrorCode('TELEGRAM_UNAUTHORIZED')).toBe(true)
      expect(isFatalErrorCode('TELEGRAM_BAD_REQUEST')).toBe(true)
    })

    it('should return true for Slack fatal errors', () => {
      expect(isFatalErrorCode('channel_not_found')).toBe(true)
      expect(isFatalErrorCode('user_not_found')).toBe(true)
      expect(isFatalErrorCode('invalid_auth')).toBe(true)
      expect(isFatalErrorCode('NO_VALID_RECIPIENTS')).toBe(true)
    })

    it('should return true for email fatal errors', () => {
      expect(isFatalErrorCode('validation_error')).toBe(true)
      expect(isFatalErrorCode('MessageRejected')).toBe(true)
    })

    it('should return true for Twilio fatal errors', () => {
      expect(isFatalErrorCode('21211')).toBe(true) // Invalid phone number
      expect(isFatalErrorCode('21610')).toBe(true) // Opted out
      expect(isFatalErrorCode('63007')).toBe(true) // Not on WhatsApp
    })

    it('should return true for web push fatal errors', () => {
      expect(isFatalErrorCode('410')).toBe(true) // Subscription expired
      expect(isFatalErrorCode('404')).toBe(true) // Not found
    })

    it('should return false for rate limit errors', () => {
      expect(isFatalErrorCode('TELEGRAM_RATE_LIMITED')).toBe(false)
      expect(isFatalErrorCode('SLACK_RATE_LIMITED')).toBe(false)
      expect(isFatalErrorCode('rate_limited')).toBe(false)
      expect(isFatalErrorCode('Throttling')).toBe(false)
    })

    it('should return false for transient errors', () => {
      expect(isFatalErrorCode('NETWORK_ERROR')).toBe(false)
      expect(isFatalErrorCode('TIMEOUT')).toBe(false)
      expect(isFatalErrorCode('SERVICE_UNAVAILABLE')).toBe(false)
    })

    it('should return false for null/undefined', () => {
      expect(isFatalErrorCode(null)).toBe(false)
      expect(isFatalErrorCode(undefined)).toBe(false)
      expect(isFatalErrorCode('')).toBe(false)
    })
  })

  describe('isFatalHttpStatus', () => {
    it('should return true for client error status codes', () => {
      expect(isFatalHttpStatus(400)).toBe(true) // Bad Request
      expect(isFatalHttpStatus(401)).toBe(true) // Unauthorized
      expect(isFatalHttpStatus(403)).toBe(true) // Forbidden
      expect(isFatalHttpStatus(404)).toBe(true) // Not Found
      expect(isFatalHttpStatus(410)).toBe(true) // Gone
      expect(isFatalHttpStatus(422)).toBe(true) // Unprocessable Entity
    })

    it('should return false for rate limit status', () => {
      expect(isFatalHttpStatus(429)).toBe(false) // Too Many Requests
    })

    it('should return false for server errors (retryable)', () => {
      expect(isFatalHttpStatus(500)).toBe(false) // Internal Server Error
      expect(isFatalHttpStatus(502)).toBe(false) // Bad Gateway
      expect(isFatalHttpStatus(503)).toBe(false) // Service Unavailable
      expect(isFatalHttpStatus(504)).toBe(false) // Gateway Timeout
    })

    it('should return false for success status codes', () => {
      expect(isFatalHttpStatus(200)).toBe(false)
      expect(isFatalHttpStatus(201)).toBe(false)
      expect(isFatalHttpStatus(204)).toBe(false)
    })

    it('should return false for null/undefined', () => {
      expect(isFatalHttpStatus(null)).toBe(false)
      expect(isFatalHttpStatus(undefined)).toBe(false)
    })
  })

  describe('isFatalProviderError', () => {
    it('should detect fatal error by code', () => {
      expect(isFatalProviderError({
        code: 'TELEGRAM_NOT_FOUND',
        message: 'Chat not found',
      })).toBe(true)
    })

    it('should detect fatal error by HTTP status in details', () => {
      expect(isFatalProviderError({
        code: 'UNKNOWN',
        message: 'Error',
        details: { statusCode: 404 },
      })).toBe(true)

      expect(isFatalProviderError({
        code: 'UNKNOWN',
        message: 'Error',
        details: { status: 403 },
      })).toBe(true)
    })

    it('should detect fatal Twilio errors by twilioCode', () => {
      expect(isFatalProviderError({
        code: 'TWILIO_ERROR',
        message: 'Invalid number',
        details: { twilioCode: 21211 },
      })).toBe(true)
    })

    it('should return false for transient errors', () => {
      expect(isFatalProviderError({
        code: 'NETWORK_ERROR',
        message: 'Connection timeout',
      })).toBe(false)

      expect(isFatalProviderError({
        code: 'UNKNOWN',
        message: 'Error',
        details: { statusCode: 500 },
      })).toBe(false)
    })

    it('should return false for rate limit errors', () => {
      expect(isFatalProviderError({
        code: 'Throttling',
        message: 'Rate limit exceeded',
        details: { statusCode: 429 },
      })).toBe(false)
    })

    it('should return false for null/undefined', () => {
      expect(isFatalProviderError(null)).toBe(false)
      expect(isFatalProviderError(undefined)).toBe(false)
    })
  })

  describe('FatalError', () => {
    it('should create a FatalError with message', () => {
      const error = new FatalError('User not found')
      expect(error.message).toBe('User not found')
      expect(error.name).toBe('FatalError')
      expect(error.isFatal).toBe(true)
    })

    it('should preserve original error as cause', () => {
      const originalError = new Error('Original error')
      const error = new FatalError('Wrapped error', { cause: originalError })
      expect(error.originalError).toBe(originalError)
    })

    it('should include error code', () => {
      const error = new FatalError('Invalid recipient', { code: 'TELEGRAM_NOT_FOUND' })
      expect(error.errorCode).toBe('TELEGRAM_NOT_FOUND')
    })
  })

  describe('isFatalError', () => {
    it('should return true for FatalError instances', () => {
      const error = new FatalError('Test error')
      expect(isFatalError(error)).toBe(true)
    })

    it('should return true for objects with isFatal=true', () => {
      const error = { isFatal: true, message: 'Test' }
      expect(isFatalError(error)).toBe(true)
    })

    it('should return false for regular errors', () => {
      const error = new Error('Regular error')
      expect(isFatalError(error)).toBe(false)
    })

    it('should return false for null/undefined', () => {
      expect(isFatalError(null)).toBe(false)
      expect(isFatalError(undefined)).toBe(false)
    })
  })

  describe('FATAL_ERROR_CODES set', () => {
    it('should contain expected error codes', () => {
      // Telegram
      expect(FATAL_ERROR_CODES.has('TELEGRAM_NOT_FOUND')).toBe(true)
      // Slack
      expect(FATAL_ERROR_CODES.has('channel_not_found')).toBe(true)
      // Email
      expect(FATAL_ERROR_CODES.has('MessageRejected')).toBe(true)
      // Twilio
      expect(FATAL_ERROR_CODES.has('21211')).toBe(true)
    })

    it('should not contain rate limit errors', () => {
      expect(FATAL_ERROR_CODES.has('rate_limited')).toBe(false)
      expect(FATAL_ERROR_CODES.has('Throttling')).toBe(false)
    })
  })

  describe('FATAL_HTTP_STATUS_CODES set', () => {
    it('should contain client error codes', () => {
      expect(FATAL_HTTP_STATUS_CODES.has(400)).toBe(true)
      expect(FATAL_HTTP_STATUS_CODES.has(404)).toBe(true)
      expect(FATAL_HTTP_STATUS_CODES.has(410)).toBe(true)
    })

    it('should not contain rate limit or server error codes', () => {
      expect(FATAL_HTTP_STATUS_CODES.has(429)).toBe(false)
      expect(FATAL_HTTP_STATUS_CODES.has(500)).toBe(false)
      expect(FATAL_HTTP_STATUS_CODES.has(503)).toBe(false)
    })
  })
})
