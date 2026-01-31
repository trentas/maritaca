import { FastifyPluginAsync } from 'fastify'
import { eq } from 'drizzle-orm'
import { createMessage, getMessage } from '../services/message.js'
import { enqueueMessage } from '../services/queue.js'
import { fetchResendLastEvent } from '../services/resend.js'
import { validateEnvelope, events, attempts } from '@maritaca/core'
import { createId } from '@paralleldrive/cuid2'

function isZodError(error: unknown): error is { name: 'ZodError'; errors: unknown } {
  return (
    error !== null &&
    typeof error === 'object' &&
    'name' in error &&
    (error as { name: string }).name === 'ZodError'
  )
}

/**
 * Message routes plugin
 */
export const messageRoutes: FastifyPluginAsync = async (fastify) => {
  const queue = fastify.queue

  /**
   * POST /v1/messages
   * Create a new message
   */
  fastify.post<{
    Body: unknown
  }>('/v1/messages', async (request, reply) => {
    try {
      const envelope = validateEnvelope(request.body)
      const db = request.server.db
      const projectId = request.projectId

      // Defense in depth: auth sets projectId; this guards against misconfiguration or future route registration changes.
      if (projectId == null || projectId === '') {
        request.log.info(
          {
            projectId,
            projectIdType: typeof projectId,
            hasProjectId: 'projectId' in request && request.projectId !== undefined,
            url: request.url,
          },
          '[messages] 401: Project ID not found in request (route check)',
        )
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Project ID not found in request',
        })
      }

      request.log.debug(
        { projectId: projectId.slice(0, 8) + '...' },
        'Creating message',
      )

      // Create message
      const result = await createMessage({ db, envelope, projectId })

      // Enqueue and emit message.queued only when the message was newly created (idempotency: don't reprocess on duplicate)
      if (result.created) {
        await enqueueMessage(queue, result.messageId, envelope)
        await db.insert(events).values({
          id: createId(),
          messageId: result.messageId,
          type: 'message.queued',
          payload: {
            channels: envelope.channels,
          },
        })
      }

      return reply.code(201).send({
        messageId: result.messageId,
        status: result.status,
        channels: result.channels,
      })
    } catch (error: unknown) {
      if (isZodError(error)) {
        return reply.code(400).send({
          error: 'Validation Error',
          message: 'Invalid envelope format',
          details: error.errors,
        })
      }

      const errMessage = error instanceof Error ? error.message : String(error)
      const errCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : undefined
      request.log.error(
        { err: error, message: errMessage, code: errCode },
        'Failed to create message',
      )

      const body: { error: string; message: string; detail?: string } = {
        error: 'Internal Server Error',
        message: 'Failed to create message',
      }
      // In development, include the underlying error to aid debugging (e.g. DB/Redis connection)
      // In production, 42P10 (constraint mismatch) is not exposed in body.detail
      if (process.env.NODE_ENV === 'development' && errMessage) {
        body.detail = errCode ? `${errMessage} (${errCode})` : errMessage
      }

      return reply.code(500).send(body)
    }
  })

  /**
   * GET /v1/messages/:id
   * Get message status and events
   */
  fastify.get<{
    Params: { id: string }
  }>('/v1/messages/:id', async (request, reply) => {
    try {
      const { id } = request.params
      const db = request.server.db
      const projectId = request.projectId

      // Defense in depth: auth sets projectId; this guards against misconfiguration or future route registration changes.
      if (projectId == null || projectId === '') {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Project ID not found in request',
        })
      }

      let message = await getMessage({ db, messageId: id, projectId })

      if (!message) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Message not found',
        })
      }

      // On-demand Resend status when we have externalId but no provider_last_event (e.g. webhook not configured yet)
      const resendAttempt = message.attempts.find(
        (a) => a.provider === 'resend' && a.channel === 'email' && a.externalId && !a.providerLastEvent,
      )
      if (resendAttempt?.externalId) {
        const apiKey = process.env.RESEND_API_KEY
        const lastEvent = await fetchResendLastEvent(resendAttempt.externalId, apiKey, {
          logger: request.log,
        })
        if (lastEvent) {
          await db
            .update(attempts)
            .set({ providerLastEvent: lastEvent })
            .where(eq(attempts.id, resendAttempt.id))
          if (!message.providerStatus.email) message.providerStatus.email = {}
          message.providerStatus.email.resend = { last_event: lastEvent }
        }
      }

      return reply.send(message)
    } catch (error: unknown) {
      request.log.error({ err: error }, 'Failed to retrieve message')
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve message',
      })
    }
  })
}
