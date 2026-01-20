import { MessagesAPI } from './api/messages.js'
import type { Envelope } from '@maritaca/core'

export interface MaritacaOptions {
  /** API key for authentication */
  apiKey: string
  /** Base URL of the Maritaca API */
  baseUrl: string
}

/**
 * Maritaca SDK client
 */
export class Maritaca {
  public messages: MessagesAPI

  constructor(options: MaritacaOptions) {
    if (!options.apiKey) {
      throw new Error('API key is required')
    }

    if (!options.baseUrl) {
      throw new Error('Base URL is required')
    }

    // Remove trailing slash from base URL
    const baseUrl = options.baseUrl.replace(/\/$/, '')

    this.messages = new MessagesAPI(baseUrl, options.apiKey)
  }
}

/**
 * Create a new Maritaca client instance
 */
export function createClient(options: MaritacaOptions): Maritaca {
  return new Maritaca(options)
}
