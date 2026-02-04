import { describe, it, expect } from 'vitest'
import {
  MaritacaError,
  MaritacaAPIError,
  MaritacaValidationError,
  MaritacaNetworkError,
} from '../errors.js'

describe('SDK Errors', () => {
  describe('MaritacaError', () => {
    it('should create error with message', () => {
      const error = new MaritacaError('Test error')
      expect(error.message).toBe('Test error')
      expect(error.name).toBe('MaritacaError')
    })

    it('should create error with code and statusCode', () => {
      const error = new MaritacaError('API failed', 'API_ERROR', 500)
      expect(error.code).toBe('API_ERROR')
      expect(error.statusCode).toBe(500)
    })
  })

  describe('MaritacaAPIError', () => {
    it('should create API error with status code', () => {
      const error = new MaritacaAPIError('Bad request', 400)
      expect(error.message).toBe('Bad request')
      expect(error.statusCode).toBe(400)
      expect(error.code).toBe('API_ERROR')
    })

    it('should include details', () => {
      const details = { field: 'email' }
      const error = new MaritacaAPIError('Validation failed', 422, details)
      expect(error.details).toEqual(details)
    })
  })

  describe('MaritacaValidationError', () => {
    it('should create validation error', () => {
      const error = new MaritacaValidationError('Invalid envelope')
      expect(error.message).toBe('Invalid envelope')
      expect(error.code).toBe('VALIDATION_ERROR')
      expect(error.name).toBe('MaritacaValidationError')
    })

    it('should include validation details', () => {
      const details = { path: ['channels'] }
      const error = new MaritacaValidationError('Invalid channels', details)
      expect(error.details).toEqual(details)
    })
  })

  describe('MaritacaNetworkError', () => {
    it('should create network error', () => {
      const error = new MaritacaNetworkError('Connection failed')
      expect(error.message).toBe('Connection failed')
      expect(error.code).toBe('NETWORK_ERROR')
      expect(error.name).toBe('MaritacaNetworkError')
    })

    it('should preserve original error', () => {
      const original = new Error('ECONNREFUSED')
      const error = new MaritacaNetworkError('Network error', original)
      expect(error.originalError).toBe(original)
    })
  })
})
