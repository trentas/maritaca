import { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { Webhook } from 'svix'
import { attempts } from '@maritaca/core'

/** Resend webhook event type (e.g. email.delivered) -> last_event value we store (e.g. delivered) */
function resendTypeToLastEvent(type: string): string | null {
  if (typeof type !== 'string' || !type.startsWith('email.')) return null
  return type.slice('email.'.length)
}

/** Extend request to include rawBody for Svix verification */
interface ResendWebhookRequest extends FastifyRequest {
  rawBody?: string
}

export const resendWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    fastify.log.warn('RESEND_WEBHOOK_SECRET is not set; Resend webhook will reject all requests')
  }

  fastify.post<{
    Body: { type?: string; data?: { email_id?: string } }
  }>('/webhooks/resend', {
    // Capture raw body for Svix signature verification (route-specific, does not affect other routes)
    preParsing: async (request: ResendWebhookRequest, _reply, payload) => {
      const chunks: Buffer[] = []
      for await (const chunk of payload) {
        chunks.push(chunk as Buffer)
      }
      const rawBody = Buffer.concat(chunks).toString('utf8')
      request.rawBody = rawBody
      // Return a new stream with the same content for Fastify to parse
      const { Readable } = await import('stream')
      return Readable.from([rawBody])
    },
  }, async (request, reply) => {
    const rawBody = (request as ResendWebhookRequest).rawBody
    if (!rawBody) {
      request.log.warn('Resend webhook: missing raw body')
      return reply.code(400).send({ error: 'Missing body' })
    }

    if (!secret) {
      request.log.warn('Resend webhook: RESEND_WEBHOOK_SECRET not configured')
      return reply.code(503).send({ error: 'Webhook not configured' })
    }

    const svixId = request.headers['svix-id'] as string | undefined
    const svixTimestamp = request.headers['svix-timestamp'] as string | undefined
    const svixSignature = request.headers['svix-signature'] as string | undefined
    if (!svixId || !svixTimestamp || !svixSignature) {
      request.log.warn({ svixId: !!svixId, svixTimestamp: !!svixTimestamp, svixSignature: !!svixSignature }, 'Resend webhook: missing Svix headers')
      return reply.code(400).send({ error: 'Missing Svix headers' })
    }

    try {
      const wh = new Webhook(secret)
      wh.verify(rawBody, {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      })
    } catch (err) {
      request.log.warn({ err }, 'Resend webhook: Svix verification failed')
      return reply.code(400).send({ error: 'Invalid signature' })
    }

    const body = request.body
    const type = body?.type
    const emailId = body?.data?.email_id
    if (!type || !emailId) {
      request.log.debug({ type: !!type, emailId: !!emailId }, 'Resend webhook: missing type or data.email_id')
      return reply.code(200).send({ received: true })
    }

    const lastEvent = resendTypeToLastEvent(type)
    if (!lastEvent) {
      request.log.debug({ type }, 'Resend webhook: ignored non-email event type')
      return reply.code(200).send({ received: true })
    }

    const db = request.server.db
    const result = await db
      .update(attempts)
      .set({ providerLastEvent: lastEvent })
      .where(eq(attempts.externalId, emailId))
      .returning({ id: attempts.id })

    if (result.length === 0) {
      request.log.debug({ emailId, type }, 'Resend webhook: no attempt found for email_id')
    } else {
      request.log.info({ emailId, type, attemptId: result[0].id }, 'Resend webhook: updated provider_last_event')
    }

    return reply.code(200).send({ received: true })
  })
}
