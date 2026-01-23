import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

/**
 * Extended Drizzle client with close method for graceful shutdown
 */
export interface DbClientWithClose extends ReturnType<typeof drizzle<typeof schema>> {
  /** Close the underlying database connection pool */
  close: () => Promise<void>
}

/**
 * Create a Drizzle database client
 * @param connectionString - PostgreSQL connection string
 * @returns Drizzle database client instance with close method
 */
export function createDbClient(connectionString: string): DbClientWithClose {
  const client = postgres(connectionString)
  const db = drizzle(client, { schema }) as DbClientWithClose
  
  // Attach close method to properly shutdown the connection pool
  db.close = async () => {
    await client.end()
  }
  
  return db
}

export type DbClient = DbClientWithClose
