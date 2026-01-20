import { WebClient } from '@slack/web-api'
import type {
  Provider,
  Envelope,
  PreparedMessage,
  ProviderResponse,
  MaritacaEvent,
} from '@maritaca/core'
import { createId } from '@paralleldrive/cuid2'

/**
 * Slack provider implementation
 */
export class SlackProvider implements Provider {
  channel = 'slack' as const

  /**
   * Validate that the envelope can be sent via Slack
   */
  validate(envelope: Envelope): void {
    const recipients = Array.isArray(envelope.recipient)
      ? envelope.recipient
      : [envelope.recipient]

    // Check if at least one recipient has Slack info
    const hasSlackRecipient = recipients.some((r) => r.slack?.userId)

    if (!hasSlackRecipient) {
      throw new Error('At least one recipient must have a Slack user ID')
    }

    // Check if sender has Slack bot token or if it's in envelope
    const hasBotToken =
      envelope.sender.slack?.botToken || process.env.SLACK_BOT_TOKEN

    if (!hasBotToken) {
      throw new Error('Slack bot token is required (from sender or SLACK_BOT_TOKEN env)')
    }
  }

  /**
   * Prepare envelope for Slack API
   */
  prepare(envelope: Envelope): PreparedMessage {
    const recipients = Array.isArray(envelope.recipient)
      ? envelope.recipient
      : [envelope.recipient]

    // Get Slack recipients
    const slackRecipients = recipients
      .filter((r) => r.slack?.userId)
      .map((r) => r.slack!.userId)

    if (slackRecipients.length === 0) {
      throw new Error('No Slack recipients found')
    }

    // Get bot token
    const botToken =
      envelope.sender.slack?.botToken || process.env.SLACK_BOT_TOKEN || ''

    // Build message text
    let text = envelope.payload.text
    if (envelope.payload.title) {
      text = `*${envelope.payload.title}*\n\n${text}`
    }

    // Use custom blocks if provided, otherwise use simple text
    const blocks = envelope.overrides?.slack?.blocks || [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text,
        },
      },
    ]

    return {
      channel: 'slack',
      data: {
        botToken,
        userIds: slackRecipients,
        text,
        blocks,
      },
    }
  }

  /**
   * Send message via Slack API
   */
  async send(prepared: PreparedMessage): Promise<ProviderResponse> {
    const { botToken, userIds, text, blocks } = prepared.data

    if (!botToken) {
      return {
        success: false,
        error: {
          code: 'MISSING_TOKEN',
          message: 'Slack bot token is required',
        },
      }
    }

    const client = new WebClient(botToken)

    try {
      // Send to each user
      const results = await Promise.allSettled(
        userIds.map((userId) =>
          client.chat.postMessage({
            channel: userId,
            text,
            blocks,
          }),
        ),
      )

      const successful = results.filter(
        (r) => r.status === 'fulfilled',
      ).length
      const failed = results.filter((r) => r.status === 'rejected').length

      if (successful === 0) {
        const firstError =
          results.find((r) => r.status === 'rejected') as PromiseRejectedResult
        return {
          success: false,
          error: {
            code: 'SLACK_API_ERROR',
            message: firstError.reason?.message || 'Failed to send Slack message',
            details: firstError.reason,
          },
        }
      }

      // Get message timestamps from successful sends
      const timestamps = results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => (r as PromiseFulfilledResult<any>).value.ts)

      return {
        success: true,
        data: {
          sent: successful,
          failed,
          timestamps,
        },
        externalId: timestamps[0]?.toString(),
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'SLACK_API_ERROR',
          message: error.message || 'Failed to send Slack message',
          details: error,
        },
      }
    }
  }

  /**
   * Map provider response to Maritaca events
   */
  mapEvents(
    response: ProviderResponse,
    messageId: string,
  ): MaritacaEvent[] {
    const events: MaritacaEvent[] = []

    if (response.success) {
      events.push({
        id: createId(),
        type: 'attempt.succeeded',
        messageId,
        channel: 'slack',
        provider: 'slack',
        timestamp: new Date(),
        payload: response.data,
      })
    } else {
      events.push({
        id: createId(),
        type: 'attempt.failed',
        messageId,
        channel: 'slack',
        provider: 'slack',
        timestamp: new Date(),
        payload: {
          error: response.error,
        },
      })
    }

    return events
  }
}
