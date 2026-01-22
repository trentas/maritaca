/**
 * Email providers module
 * 
 * This file re-exports from the email/ directory for backwards compatibility.
 * New code should import directly from './email/index.js'
 */

// Re-export everything from the email providers module
export {
  createEmailProvider,
  MockEmailProvider,
  ResendProvider,
  SESProvider,
} from './email/index.js'

export type {
  EmailProviderType,
  CreateEmailProviderOptions,
  MockEmailProviderSimulation,
  MockEmailProviderOptions,
  ResendProviderOptions,
  SESProviderOptions,
} from './email/index.js'

// Keep EmailProvider as an alias for MockEmailProvider for backwards compatibility
import { MockEmailProvider } from './email/index.js'

/**
 * @deprecated Use MockEmailProvider instead
 */
export const EmailProvider = MockEmailProvider

/**
 * @deprecated Use MockEmailProviderSimulation instead
 */
export type EmailProviderSimulation = import('./email/index.js').MockEmailProviderSimulation

/**
 * @deprecated Use MockEmailProviderOptions instead  
 */
export type EmailProviderOptions = import('./email/index.js').MockEmailProviderOptions
