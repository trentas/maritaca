import bcrypt from 'bcrypt'
import { createHash } from 'crypto'
import { createId } from '@paralleldrive/cuid2'
import { eq, desc } from 'drizzle-orm'
import { apiKeys, type DbClient } from '@maritaca/core'

/**
 * API key provisioning service.
 *
 * Mirrors the CLI scripts (scripts/create-api-key.ts, list-api-keys.ts,
 * remove-api-key.ts) so keys can be minted programmatically at runtime via the
 * admin HTTP API. Kept framework-agnostic (takes a DbClient) so it can be unit
 * tested without a running server.
 */

/** bcrypt cost factor; matches scripts/create-api-key.ts */
const BCRYPT_ROUNDS = 10

/**
 * Generate a prefix for fast API key lookup.
 * Uses the first 16 characters of the SHA-256 hash (matches auth middleware).
 */
export function generateKeyPrefix(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').substring(0, 16)
}

export interface CreatedApiKey {
  id: string
  projectId: string
  /** Plaintext API key — returned exactly once, never stored or retrievable again. */
  apiKey: string
  keyPrefix: string
  createdAt: Date
}

/**
 * Create a new API key bound to a project.
 * Generates a random `maritaca_<cuid>` key, stores its bcrypt hash + lookup
 * prefix, and returns the plaintext value once.
 */
export async function createApiKey(db: DbClient, projectId: string): Promise<CreatedApiKey> {
  const apiKeyValue = `maritaca_${createId()}`
  const keyHash = await bcrypt.hash(apiKeyValue, BCRYPT_ROUNDS)
  const keyPrefix = generateKeyPrefix(apiKeyValue)

  const [row] = await db
    .insert(apiKeys)
    .values({ keyHash, keyPrefix, projectId })
    .returning()

  return {
    id: row.id,
    projectId: row.projectId,
    apiKey: apiKeyValue,
    keyPrefix: row.keyPrefix,
    createdAt: row.createdAt,
  }
}

export interface ApiKeyMetadata {
  id: string
  projectId: string
  keyPrefix: string
  createdAt: Date
}

/**
 * List API keys for a project (metadata only — the secret is never stored and
 * cannot be returned).
 */
export async function listApiKeys(db: DbClient, projectId: string): Promise<ApiKeyMetadata[]> {
  return db
    .select({
      id: apiKeys.id,
      projectId: apiKeys.projectId,
      keyPrefix: apiKeys.keyPrefix,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.projectId, projectId))
    .orderBy(desc(apiKeys.createdAt))
}

/**
 * Revoke (delete) an API key by id.
 * Returns true if a row was deleted, false if no key matched.
 */
export async function revokeApiKey(db: DbClient, id: string): Promise<boolean> {
  const deleted = await db.delete(apiKeys).where(eq(apiKeys.id, id)).returning({ id: apiKeys.id })
  return deleted.length > 0
}
