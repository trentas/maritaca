#!/usr/bin/env node
/**
 * Remove an API key by id.
 * Usage: pnpm remove-api-key <id>
 * Get ids with: pnpm list-api-keys
 */

import { createDbClient } from '../packages/core/src/db/client.js'
import { apiKeys } from '../packages/core/src/db/schema.js'
import { eq } from 'drizzle-orm'

const databaseUrl = process.env.DATABASE_URL || 'postgresql://maritaca:maritaca@localhost:5432/maritaca'
const id = process.argv[2]

async function removeApiKey() {
  if (!id) {
    console.error('Usage: pnpm remove-api-key <id>')
    console.error('List keys with: pnpm list-api-keys')
    process.exit(1)
  }

  const db = createDbClient(databaseUrl)

  const deleted = await db.delete(apiKeys).where(eq(apiKeys.id, id)).returning({ id: apiKeys.id })

  if (deleted.length === 0) {
    console.error(`\n❌ No API key found with id: ${id}\n`)
    process.exit(1)
  }

  console.log(`\n✅ API key removed: ${id}\n`)
  process.exit(0)
}

removeApiKey().catch((error) => {
  console.error('❌ Error removing API key:', error)
  process.exit(1)
})
