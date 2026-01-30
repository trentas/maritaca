import { sql } from 'drizzle-orm'
import type { DbClient } from '../db/client.js'

/**
 * Partition management utilities for audit_logs table
 * 
 * PostgreSQL partitioning is used to enable:
 * - Efficient data archival (drop old partitions)
 * - Parallel query execution
 * - Easier sharding across databases
 *
 * All partition operations no-op with a warning if audit_logs exists but is not
 * partitioned (e.g. created by Drizzle from schema). Ensure 0004_create_audit_logs.sql
 * has been applied so the table is created with PARTITION BY RANGE (created_at).
 */

/**
 * Returns true if the audit_logs table exists and is a partitioned table.
 * If the table was created from Drizzle schema or an old migration, it may
 * exist as a regular table; partition operations will fail in that case.
 */
export async function isAuditLogsPartitioned(db: DbClient): Promise<boolean> {
  const result = await db.execute(sql.raw(`
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'audit_logs' AND c.relkind = 'p'
  `))
  const rows = Array.isArray(result) ? result : (result as any).rows ?? []
  return rows.length > 0
}

/**
 * Generate partition name for a given date
 */
function getPartitionName(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `audit_logs_${year}_${month}`
}

/**
 * Get the start of a month
 */
function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

/**
 * Get the start of the next month
 */
function getNextMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1)
}

/**
 * Format date for PostgreSQL
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

/**
 * Create a partition for a specific month
 * 
 * @param db - Database client
 * @param date - Any date within the target month
 */
export async function createPartition(db: DbClient, date: Date): Promise<void> {
  if (!(await isAuditLogsPartitioned(db))) {
    return
  }
  const partitionName = getPartitionName(date)
  const rangeStart = formatDate(getMonthStart(date))
  const rangeEnd = formatDate(getNextMonthStart(date))

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${partitionName}
    PARTITION OF audit_logs
    FOR VALUES FROM ('${rangeStart}') TO ('${rangeEnd}')
  `))
}

/**
 * Ensure partitions exist for the next N months
 * 
 * @param db - Database client
 * @param monthsAhead - Number of months to create partitions for (default: 3)
 */
export async function ensurePartitions(
  db: DbClient,
  monthsAhead: number = 3,
): Promise<string[]> {
  if (!(await isAuditLogsPartitioned(db))) {
    return []
  }
  const created: string[] = []
  const now = new Date()

  for (let i = 0; i <= monthsAhead; i++) {
    const targetDate = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const partitionName = getPartitionName(targetDate)

    try {
      await createPartition(db, targetDate)
      created.push(partitionName)
    } catch (error: any) {
      // Partition might already exist - that's fine
      if (!error.message?.includes('already exists')) {
        throw error
      }
    }
  }

  return created
}

/**
 * Drop a partition (for data retention/archival)
 * 
 * WARNING: This permanently deletes all data in the partition!
 * 
 * @param db - Database client
 * @param date - Any date within the target month
 */
export async function dropPartition(db: DbClient, date: Date): Promise<void> {
  const partitionName = getPartitionName(date)
  await db.execute(sql.raw(`DROP TABLE IF EXISTS ${partitionName}`))
}

/**
 * Detach a partition (preserves data, removes from parent table)
 * Useful for archiving to cold storage before dropping
 * 
 * @param db - Database client
 * @param date - Any date within the target month
 */
export async function detachPartition(db: DbClient, date: Date): Promise<void> {
  if (!(await isAuditLogsPartitioned(db))) {
    return
  }
  const partitionName = getPartitionName(date)
  await db.execute(sql.raw(`
    ALTER TABLE audit_logs DETACH PARTITION ${partitionName}
  `))
}

/**
 * Drop partitions older than the retention period
 * 
 * @param db - Database client
 * @param retentionMonths - Number of months to retain (default: 12)
 * @returns List of dropped partition names
 */
export async function dropOldPartitions(
  db: DbClient,
  retentionMonths: number = 12,
): Promise<string[]> {
  if (!(await isAuditLogsPartitioned(db))) {
    return []
  }
  const dropped: string[] = []
  const cutoffDate = new Date()
  cutoffDate.setMonth(cutoffDate.getMonth() - retentionMonths)

  // Get list of existing partitions
  const result = await db.execute(sql.raw(`
    SELECT tablename 
    FROM pg_tables 
    WHERE tablename LIKE 'audit_logs_%' 
    AND schemaname = 'public'
    ORDER BY tablename
  `))

  // Drizzle returns array directly for postgres-js driver
  const rows = Array.isArray(result) ? result : (result as any).rows ?? []

  for (const row of rows as { tablename: string }[]) {
    const partitionName = row.tablename
    
    // Parse date from partition name (audit_logs_YYYY_MM)
    const match = partitionName.match(/audit_logs_(\d{4})_(\d{2})/)
    if (!match) continue

    const partitionDate = new Date(parseInt(match[1]), parseInt(match[2]) - 1, 1)
    
    if (partitionDate < cutoffDate) {
      await db.execute(sql.raw(`DROP TABLE IF EXISTS ${partitionName}`))
      dropped.push(partitionName)
    }
  }

  return dropped
}

/**
 * Get partition statistics
 */
export async function getPartitionStats(db: DbClient): Promise<{
  partitions: Array<{
    name: string
    rowCount: number
    sizeBytes: number
  }>
  totalRows: number
  totalSizeBytes: number
}> {
  if (!(await isAuditLogsPartitioned(db))) {
    return { partitions: [], totalRows: 0, totalSizeBytes: 0 }
  }
  const result = await db.execute(sql.raw(`
    SELECT 
      c.relname as name,
      c.reltuples::bigint as row_count,
      pg_table_size(c.oid) as size_bytes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname LIKE 'audit_logs_%'
    AND n.nspname = 'public'
    AND c.relkind = 'r'
    ORDER BY c.relname
  `))

  // Drizzle returns array directly for postgres-js driver
  const rows = Array.isArray(result) ? result : (result as any).rows ?? []

  const partitions = (rows as any[]).map((row) => ({
    name: row.name,
    rowCount: parseInt(row.row_count) || 0,
    sizeBytes: parseInt(row.size_bytes) || 0,
  }))

  return {
    partitions,
    totalRows: partitions.reduce((sum, p) => sum + p.rowCount, 0),
    totalSizeBytes: partitions.reduce((sum, p) => sum + p.sizeBytes, 0),
  }
}
