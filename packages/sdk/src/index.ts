// Main client
export { Maritaca, createClient, type MaritacaOptions } from './client.js'

// API classes
export { MessagesAPI } from './api/messages.js'
export type {
  SendMessageResponse,
  GetMessageResponse,
} from './api/messages.js'

// Errors
export {
  MaritacaError,
  MaritacaAPIError,
  MaritacaValidationError,
  MaritacaNetworkError,
} from './errors.js'

// Types
export * from './types.js'
