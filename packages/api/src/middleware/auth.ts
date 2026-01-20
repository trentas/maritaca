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
 * API Key authentication middleware
 * Validates API keys from Authorization header
 * Uses keyPrefix for optimized database lookup
 */
export const authMiddleware: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request: FastifyRequest, reply) => {
    // Skip authentication for health check
    if (request.url === '/health') {
      return
    }

    const authHeader = request.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header',
      })
    }

    const apiKey = authHeader.substring(7) // Remove 'Bearer ' prefix

    if (!apiKey) {
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
        const matches = await bcrypt.compare(apiKey, keyRecord.keyHash)
        if (matches) {
          isValid = true
          projectId = keyRecord.projectId
          break
        }
      } catch (err) {
        // Continue checking other candidates
        continue
      }
    }

    if (!isValid) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Invalid API key',
      })
    }

    // Attach API key and project ID to request
    request.apiKey = apiKey
    request.projectId = projectId
  })
}
