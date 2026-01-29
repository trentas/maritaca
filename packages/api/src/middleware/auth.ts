import { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { createHash } from 'crypto'
import { apiKeys } from '@maritaca/core'
import bcrypt from 'bcrypt'

/**
 * Extend Fastify types to include API key in request
 */
declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: string
    projectId?: string
  }
}

/**
 * Generate a prefix for fast API key lookup
 * Uses first 16 characters of SHA-256 hash
 */
function generateKeyPrefix(apiKey: string): string {
  const hash = createHash('sha256').update(apiKey).digest('hex')
  return hash.substring(0, 16)
}

/**
 * Creates the onRequest handler for API key authentication.
 * Must be added to the root server (server.addHook('onRequest', ...)) so it runs
 * for all requests; if registered as a plugin, Fastify encapsulation prevents the
 * hook from running for routes registered in sibling plugins.
 */
export function createAuthOnRequestHandler(): (request: FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void> {
  return async (request: FastifyRequest, reply: import('fastify').FastifyReply) => {
    request.log.debug({ url: request.url }, '[auth] onRequest started')

    // Skip authentication for health check and Resend webhook (verified by Svix signature)
    if (request.url === '/health') {
      return
    }
    if (request.url === '/webhooks/resend' && request.method === 'POST') {
      return
    }

    const authHeader = request.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      request.log.info(
        { authHeaderPresent: !!authHeader, url: request.url },
        '[auth] 401: Missing or invalid Authorization header',
      )
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header',
      })
    }

    const apiKey = authHeader.substring(7) // Remove 'Bearer ' prefix

    if (!apiKey) {
      request.log.info({ url: request.url }, '[auth] 401: API key is required (Bearer with empty value)')
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'API key is required',
      })
    }

    // Get database client
    const db = request.server.db

    // Generate prefix for fast lookup
    const keyPrefix = generateKeyPrefix(apiKey)

    // Find API keys with matching prefix (optimized query)
    const candidateKeys = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyPrefix, keyPrefix))

    // If no candidates found, key is invalid
    if (candidateKeys.length === 0) {
      request.log.info(
        { keyPrefix, url: request.url },
        '[auth] 401: Invalid API key (no candidate keys found for prefix)',
      )
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Invalid API key',
      })
    }

    // Verify the actual key hash (only check candidates)
    let isValid = false
    let projectId: string | undefined

    for (const keyRecord of candidateKeys) {
      try {
        const row = keyRecord as Record<string, unknown>
        const hash = (row.keyHash ?? row.key_hash) as string | undefined
        if (!hash) continue
        const matches = await bcrypt.compare(apiKey, hash)
        if (matches) {
          isValid = true
          // Driver may return snake_case (project_id) or Drizzle camelCase (projectId)
          projectId = (row.projectId ?? row.project_id) as string | undefined
          break
        }
      } catch (err) {
        continue
      }
    }

    if (!isValid) {
      request.log.info(
        { keyPrefix, candidatesCount: candidateKeys.length, url: request.url },
        '[auth] 401: Invalid API key (bcrypt did not match any candidate)',
      )
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Invalid API key',
      })
    }

    // Reject keys that have no project (e.g. legacy rows with null project_id)
    if (projectId == null || projectId === '') {
      const firstRow = candidateKeys[0] as Record<string, unknown>
      request.log.info(
        {
          projectId,
          projectIdType: typeof projectId,
          rowKeys: firstRow ? Object.keys(firstRow) : [],
          projectIdFromRow: firstRow?.projectId ?? firstRow?.project_id,
          url: request.url,
        },
        '[auth] 401: API key has no project (projectId null/empty)',
      )
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'API key has no project; create a new key with pnpm create-api-key [key] [project-id]',
      })
    }

    // Attach API key and project ID to request (use decorateRequest so it propagates in encapsulated contexts)
    request.apiKey = apiKey
    request.projectId = projectId
    request.log.info(
      { projectId, keyPrefix, url: request.url },
      '[auth] OK: API key valid, projectId set',
    )
  }
}

/**
 * Plugin form of auth (adds the same handler as a hook in encapsulated context).
 * Prefer adding the hook to the root server via createAuthOnRequestHandler() so
 * it runs for all routes; this plugin is kept for backwards compatibility.
 */
export const authMiddleware: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', createAuthOnRequestHandler())
}
