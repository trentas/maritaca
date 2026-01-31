import type { Logger } from '@maritaca/core'

const RESEND_API_BASE = 'https://api.resend.com'

/** Default timeout for Resend API requests (5 seconds) */
const RESEND_FETCH_TIMEOUT_MS = 5000

export interface FetchResendLastEventOptions {
  /** Optional logger for debugging failed requests */
  logger?: Logger
  /** Request timeout in milliseconds (default: 5000) */
  timeoutMs?: number
}

/**
 * Fetch last_event for a sent email from Resend API (GET /emails/:id).
 * Used as on-demand fallback when webhook has not yet updated provider_last_event.
 * @param externalId - Resend email id
 * @param apiKey - RESEND_API_KEY (if not set, returns null)
 * @param options - Optional logger and timeout configuration
 * @returns last_event string (e.g. delivered, bounced) or null
 */
export async function fetchResendLastEvent(
  externalId: string,
  apiKey: string | undefined,
  options?: FetchResendLastEventOptions,
): Promise<string | null> {
  if (!apiKey?.trim()) return null
  
  const timeoutMs = options?.timeoutMs ?? RESEND_FETCH_TIMEOUT_MS
  
  try {
    const res = await fetch(`${RESEND_API_BASE}/emails/${encodeURIComponent(externalId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
      options?.logger?.debug(
        { externalId, status: res.status },
        'Resend API returned non-OK status when fetching email status',
      )
      return null
    }
    const data = (await res.json()) as { last_event?: string }
    return typeof data?.last_event === 'string' ? data.last_event : null
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    options?.logger?.debug(
      { externalId, error: message },
      'Failed to fetch Resend email status',
    )
    return null
  }
}
