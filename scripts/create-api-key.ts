#!/usr/bin/env node
/**
 * Script to create an API key for Maritaca
 * Usage: pnpm tsx scripts/create-api-key.ts [api-key-value] [project-id]
 */

import bcrypt from 'bcrypt'
import { createHash } from 'crypto'
import { createDbClient } from '../packages/core/src/db/client.js'
import { apiKeys } from '../packages/core/src/db/schema.js'
import { createId } from '@paralleldrive/cuid2'

const databaseUrl = process.env.DATABASE_URL || 'postgresql://maritaca:maritaca@localhost:5432/maritaca'
const apiKeyValue = process.argv[2] || `maritaca_${createId()}`
const projectId = process.argv[3] || 'default'

/**
 * Generate a prefix for fast API key lookup
 * Uses first 16 characters of SHA-256 hash
 */
function generateKeyPrefix(apiKey: string): string {
  const hash = createHash('sha256').update(apiKey).digest('hex')
  return hash.substring(0, 16)
}

async function createApiKey() {
  const db = createDbClient(databaseUrl)

  // Hash the API key with bcrypt for secure storage
  const keyHash = await bcrypt.hash(apiKeyValue, 10)

  // Generate prefix for fast lookup
  const keyPrefix = generateKeyPrefix(apiKeyValue)

  // Insert into database
  const [apiKey] = await db
    .insert(apiKeys)
    .values({
      keyHash,
      keyPrefix,
      projectId,
    })
    .returning()

  console.log('\n✅ API Key created successfully!')
  console.log('\n📋 Details:')
  console.log(`   ID: ${apiKey.id}`)
  console.log(`   Project ID: ${apiKey.projectId}`)
  console.log(`   Created at: ${apiKey.createdAt}`)
  console.log('\n🔑 API Key (save this, it won\'t be shown again):')
  console.log(`   ${apiKeyValue}`)
  console.log('\n💡 Usage:')
  console.log(`   curl -H "Authorization: Bearer ${apiKeyValue}" http://localhost:7377/v1/messages\n`)

  process.exit(0)
}

createApiKey().catch((error) => {
  console.error('❌ Error creating API key:', error)
  process.exit(1)
})
