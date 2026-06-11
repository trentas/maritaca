import { FastifyReply, FastifyRequest } from 'fastify'
import { createHash, timingSafeEqual } from 'crypto'

/**
 * Admin authentication for provisioning routes (/v1/admin/*).
 *
 * Gated behind a dedicated `ADMIN_API_KEY` credential, distinct from project
 * API keys, so a normal project key cannot mint or revoke keys for other
 * projects. The project-key auth hook (middleware/auth.ts) skips /v1/admin/*;
 * this hook is registered inside the admin routes plugin so it only guards
 * admin routes (Fastify encapsulation keeps it from affecting sibling routes).
 */

/**
 * Constant-time comparison of a provided credential against the expected one.
 * Hashes both to a fixed length first so the comparison never leaks length and
 * timingSafeEqual never throws on mismatched buffer sizes.
 */
export function verifyAdminKey(provided: string, expected: string): boolean {
  if (!provided || !expected) return false
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/**
 * Creates the onRequest handler enforcing admin authentication.
 * - 503 when `ADMIN_API_KEY` is not configured (admin API disabled).
 * - 401 when the Authorization header is missing or malformed.
 * - 403 when a Bearer token is present but does not match (e.g. a project key).
 */
export function createAdminAuthOnRequestHandler(): (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<void> {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const adminKey = process.env.ADMIN_API_KEY

    if (!adminKey) {
      request.log.warn({ url: request.url }, '[admin-auth] 503: ADMIN_API_KEY not configured')
      return reply.code(503).send({
        error: 'Service Unavailable',
        message: 'Admin API is not configured (ADMIN_API_KEY missing)',
      })
    }

    const authHeader = request.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      request.log.info({ url: request.url }, '[admin-auth] 401: missing or invalid Authorization header')
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header',
      })
    }

    const provided = authHeader.substring(7) // Remove 'Bearer ' prefix
    if (!verifyAdminKey(provided, adminKey)) {
      request.log.info({ url: request.url }, '[admin-auth] 403: invalid admin credentials')
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Invalid admin credentials',
      })
    }

    request.log.debug({ url: request.url }, '[admin-auth] OK')
  }
}
