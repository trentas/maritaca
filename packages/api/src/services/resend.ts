const RESEND_API_BASE = 'https://api.resend.com'

/**
 * Fetch last_event for a sent email from Resend API (GET /emails/:id).
 * Used as on-demand fallback when webhook has not yet updated provider_last_event.
 * @param externalId - Resend email id
 * @param apiKey - RESEND_API_KEY (if not set, returns null)
 * @returns last_event string (e.g. delivered, bounced) or null
 */
export async function fetchResendLastEvent(
  externalId: string,
  apiKey: string | undefined,
): Promise<string | null> {
  if (!apiKey?.trim()) return null
  try {
    const res = await fetch(`${RESEND_API_BASE}/emails/${encodeURIComponent(externalId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { last_event?: string }
    return typeof data?.last_event === 'string' ? data.last_event : null
  } catch {
    return null
  }
}
