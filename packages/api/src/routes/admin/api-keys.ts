import { FastifyPluginAsync } from 'fastify'
import { createAdminAuthOnRequestHandler } from '../../middleware/adminAuth.js'
import { createApiKey, listApiKeys, revokeApiKey } from '../../services/apiKeys.js'

/**
 * Admin API key provisioning routes (/v1/admin/api-keys).
 *
 * Lets multi-tenant consumers mint one Maritaca project / API key per
 * downstream tenant at onboarding, instead of the manual create-api-key CLI.
 * Gated behind ADMIN_API_KEY (see middleware/adminAuth.ts). The admin-auth hook
 * is added inside this plugin so Fastify encapsulation scopes it to these
 * routes only; the global project-key auth hook skips /v1/admin/*.
 */
export const adminApiKeyRoutes: FastifyPluginAsync = async (fastify) => {
  if (!process.env.ADMIN_API_KEY) {
    fastify.log.warn('ADMIN_API_KEY is not set; admin API (/v1/admin/*) will reject all requests with 503')
  }

  fastify.addHook('onRequest', createAdminAuthOnRequestHandler())

  /**
   * POST /v1/admin/api-keys
   * Create an API key bound to a project. Returns the plaintext key exactly once.
   */
  fastify.post<{ Body: { projectId?: unknown } }>('/v1/admin/api-keys', async (request, reply) => {
    const body = (request.body ?? {}) as { projectId?: unknown }
    const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : ''

    if (!projectId) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'projectId is required',
      })
    }

    const created = await createApiKey(request.server.db, projectId)
    request.log.info({ id: created.id, projectId: created.projectId }, '[admin] API key created')
    return reply.code(201).send(created)
  })

  /**
   * GET /v1/admin/api-keys?projectId=…
   * List API keys for a project (metadata only — never the secret).
   */
  fastify.get<{ Querystring: { projectId?: string } }>('/v1/admin/api-keys', async (request, reply) => {
    const projectId = (request.query.projectId ?? '').trim()

    if (!projectId) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'projectId query parameter is required',
      })
    }

    const keys = await listApiKeys(request.server.db, projectId)
    return reply.send({ projectId, apiKeys: keys })
  })

  /**
   * DELETE /v1/admin/api-keys/:id
   * Revoke (delete) an API key by id.
   */
  fastify.delete<{ Params: { id: string } }>('/v1/admin/api-keys/:id', async (request, reply) => {
    const { id } = request.params

    const revoked = await revokeApiKey(request.server.db, id)
    if (!revoked) {
      return reply.code(404).send({
        error: 'Not Found',
        message: `No API key found with id: ${id}`,
      })
    }

    request.log.info({ id }, '[admin] API key revoked')
    return reply.send({ status: 'revoked', id })
  })
}
