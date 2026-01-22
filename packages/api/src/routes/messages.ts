import { FastifyPluginAsync } from 'fastify'
import { createMessage, getMessage } from '../services/message.js'
import { enqueueMessage } from '../services/queue.js'
import { validateEnvelope, events } from '@maritaca/core'
import { createId } from '@paralleldrive/cuid2'

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
  }>('/messages', async (request, reply) => {
    try {
      const envelope = validateEnvelope(request.body)
      const db = request.server.db
      const projectId = request.projectId

      if (!projectId) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Project ID not found in request',
        })
      }

      // Create message
      const result = await createMessage({ db, envelope, projectId })

      // Enqueue for processing
      await enqueueMessage(queue, result.messageId, envelope)

      // Emit message.queued event
      await db.insert(events).values({
        id: createId(),
        messageId: result.messageId,
        type: 'message.queued',
        payload: {
          channels: envelope.channels,
        },
      })

      return reply.code(201).send({
        messageId: result.messageId,
        status: result.status,
        channels: result.channels,
      })
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return reply.code(400).send({
          error: 'Validation Error',
          message: 'Invalid envelope format',
          details: error.errors,
        })
      }

      request.log.error(error)
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create message',
      })
    }
  })

  /**
   * GET /v1/messages/:id
   * Get message status and events
   */
  fastify.get<{
    Params: { id: string }
  }>('/messages/:id', async (request, reply) => {
    try {
      const { id } = request.params
      const db = request.server.db
      const projectId = request.projectId

      if (!projectId) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Project ID not found in request',
        })
      }

      const message = await getMessage({ db, messageId: id, projectId })

      if (!message) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Message not found',
        })
      }

      return reply.send(message)
    } catch (error: any) {
      request.log.error(error)
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve message',
      })
    }
  })
}
