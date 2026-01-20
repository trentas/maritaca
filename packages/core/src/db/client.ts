import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

/**
 * Create a Drizzle database client
 * @param connectionString - PostgreSQL connection string
 * @returns Drizzle database client instance
 */
export function createDbClient(connectionString: string) {
  const client = postgres(connectionString)
  return drizzle(client, { schema })
}

export type DbClient = ReturnType<typeof createDbClient>
