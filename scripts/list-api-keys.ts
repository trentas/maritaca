#!/usr/bin/env node
/**
 * List all API keys in the database (id, projectId, keyPrefix, createdAt).
 * The actual key value is not stored; keyPrefix is the first 16 chars of SHA-256 for reference.
 * Usage: pnpm list-api-keys
 */

import { createDbClient } from '../packages/core/src/db/client.js'
import { apiKeys } from '../packages/core/src/db/schema.js'
import { desc } from 'drizzle-orm'

const databaseUrl = process.env.DATABASE_URL || 'postgresql://maritaca:maritaca@localhost:5432/maritaca'

async function listApiKeys() {
  const db = createDbClient(databaseUrl)

  const keys = await db
    .select({
      id: apiKeys.id,
      projectId: apiKeys.projectId,
      keyPrefix: apiKeys.keyPrefix,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .orderBy(desc(apiKeys.createdAt))

  if (keys.length === 0) {
    console.log('\nNo API keys found.\n')
    process.exit(0)
    return
  }

  console.log('\nAPI Keys:\n')
  for (const k of keys) {
    console.log(`  ID:         ${k.id}`)
    console.log(`  Project:    ${k.projectId}`)
    console.log(`  Key prefix: ${k.keyPrefix}`)
    console.log(`  Created:    ${k.createdAt}`)
    console.log('')
  }
  process.exit(0)
}

listApiKeys().catch((error) => {
  console.error('❌ Error listing API keys:', error)
  process.exit(1)
})
