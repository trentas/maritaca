/**
 * Base error class for Maritaca SDK
 */
export class MaritacaError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number,
  ) {
    super(message)
    this.name = 'MaritacaError'
  }
}

/**
 * API error from Maritaca server
 */
export class MaritacaAPIError extends MaritacaError {
  constructor(
    message: string,
    public statusCode: number,
    public details?: any,
  ) {
    super(message, 'API_ERROR', statusCode)
    this.name = 'MaritacaAPIError'
  }
}

/**
 * Validation error
 */
export class MaritacaValidationError extends MaritacaError {
  constructor(message: string, public details?: any) {
    super(message, 'VALIDATION_ERROR')
    this.name = 'MaritacaValidationError'
  }
}

/**
 * Network error
 */
export class MaritacaNetworkError extends MaritacaError {
  constructor(message: string, public originalError?: Error) {
    super(message, 'NETWORK_ERROR')
    this.name = 'MaritacaNetworkError'
  }
}
