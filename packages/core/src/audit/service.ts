import { eq, and, gte, lt, desc, sql } from 'drizzle-orm'
import { context, trace } from '@opentelemetry/api'
import { createId } from '@paralleldrive/cuid2'
import type { DbClient } from '../db/client.js'
import { auditLogs } from '../db/schema.js'
import type { AuditEvent, AuditLog, AuditQueryOptions } from '../types/audit.js'
import { encryptPii, decryptPii, isEncryptedData } from './encryption.js'
import { hashPii } from '../logger/masking.js'

/**
 * Audit Service options
 */
export interface AuditServiceOptions {
  /** Encryption key for PII data (required if storing PII) */
  encryptionKey?: string
  /** Whether to hash subject IDs for privacy (default: true) */
  hashSubjectIds?: boolean
}

/**
 * Audit Service for GDPR/LGPD compliant logging
 * 
 * Features:
 * - Encrypted PII storage
 * - Subject-based queries for DSAR
 * - Automatic trace context injection
 * - Partitioned table support
 * 
 * @example
 * ```typescript
 * const auditService = new AuditService(db, {
 *   encryptionKey: process.env.AUDIT_ENCRYPTION_KEY,
 * })
 * 
 * await auditService.log({
 *   action: 'email.sent',
 *   actor: { type: 'system', id: 'resend-provider' },
 *   subject: { type: 'recipient', id: 'user@example.com' },
 *   resource: { type: 'message', id: messageId },
 *   projectId: 'proj_123',
 *   piiData: { recipient: 'user@example.com' },
 * })
 * ```
 */
export class AuditService {
  private encryptionKey?: string
  private hashSubjectIds: boolean

  constructor(
    private db: DbClient,
    options?: AuditServiceOptions,
  ) {
    this.encryptionKey = options?.encryptionKey ?? process.env.AUDIT_ENCRYPTION_KEY
    this.hashSubjectIds = options?.hashSubjectIds ?? true
  }

  /**
   * Get current trace ID from OpenTelemetry context
   */
  private getCurrentTraceId(): string | undefined {
    const activeContext = context.active()
    const span = trace.getSpan(activeContext)
    if (span) {
      return span.spanContext().traceId
    }
    return undefined
  }

  /**
   * Log an audit event
   */
  async log(event: AuditEvent): Promise<string> {
    const id = createId()
    
    // Encrypt PII data if encryption key is available
    let piiData: Record<string, unknown> | null = null
    if (event.piiData && this.encryptionKey) {
      piiData = encryptPii(event.piiData, this.encryptionKey) as unknown as Record<string, unknown>
    } else if (event.piiData) {
      // No encryption key - store warning in metadata
      piiData = { warning: 'PII not encrypted - no encryption key configured' }
    }

    // Hash subject ID if configured
    const subjectId = event.subject?.id
      ? (this.hashSubjectIds ? hashPii(event.subject.id) : event.subject.id)
      : undefined

    await this.db.insert(auditLogs).values({
      id,
      action: event.action,
      actorType: event.actor.type,
      actorId: event.actor.id,
      subjectType: event.subject?.type,
      subjectId,
      resourceType: event.resource.type,
      resourceId: event.resource.id,
      projectId: event.projectId,
      requestId: event.requestId,
      traceId: this.getCurrentTraceId(),
      piiData,
      metadata: event.metadata,
    })

    return id
  }

  /**
   * Find audit logs by query options
   */
  async find(options: AuditQueryOptions): Promise<AuditLog[]> {
    const conditions = []

    if (options.subjectId) {
      // Hash the subject ID for lookup if we're hashing IDs
      const lookupId = this.hashSubjectIds ? hashPii(options.subjectId) : options.subjectId
      conditions.push(eq(auditLogs.subjectId, lookupId))
    }

    if (options.projectId) {
      conditions.push(eq(auditLogs.projectId, options.projectId))
    }

    if (options.resourceId) {
      conditions.push(eq(auditLogs.resourceId, options.resourceId))
    }

    if (options.action) {
      conditions.push(eq(auditLogs.action, options.action))
    }

    if (options.startDate) {
      conditions.push(gte(auditLogs.createdAt, options.startDate))
    }

    if (options.endDate) {
      conditions.push(lt(auditLogs.createdAt, options.endDate))
    }

    const query = this.db
      .select()
      .from(auditLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .limit(options.limit ?? 100)
      .offset(options.offset ?? 0)

    const results = await query

    return results.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      action: row.action,
      actorType: row.actorType,
      actorId: row.actorId,
      subjectType: row.subjectType ?? undefined,
      subjectId: row.subjectId ?? undefined,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      projectId: row.projectId,
      requestId: row.requestId ?? undefined,
      traceId: row.traceId ?? undefined,
      piiData: row.piiData as Record<string, unknown> | undefined,
      metadata: row.metadata as Record<string, unknown> | undefined,
    }))
  }

  /**
   * Find all audit logs for a subject (for DSAR requests)
   */
  async findBySubject(
    subjectId: string,
    options?: { startDate?: Date; endDate?: Date; limit?: number },
  ): Promise<AuditLog[]> {
    return this.find({
      subjectId,
      startDate: options?.startDate,
      endDate: options?.endDate,
      limit: options?.limit,
    })
  }

  /**
   * Find all audit logs for a resource (e.g., a message)
   */
  async findByResource(resourceId: string): Promise<AuditLog[]> {
    return this.find({ resourceId })
  }

  /**
   * Decrypt PII data from an audit log
   * Requires the encryption key to be configured
   * 
   * @param auditLog - Audit log with encrypted PII
   * @returns Decrypted PII data
   * @throws Error if no encryption key or data is not encrypted
   */
  decryptPii(auditLog: AuditLog): Record<string, unknown> {
    if (!this.encryptionKey) {
      throw new Error('Encryption key is required to decrypt PII')
    }

    if (!auditLog.piiData) {
      throw new Error('No PII data in audit log')
    }

    if (!isEncryptedData(auditLog.piiData)) {
      throw new Error('PII data is not encrypted')
    }

    return decryptPii(auditLog.piiData, this.encryptionKey)
  }

  /**
   * Delete audit logs for a subject (for GDPR right to erasure)
   * Note: This should be used carefully and may require additional compliance checks
   */
  async deleteBySubject(subjectId: string): Promise<number> {
    const lookupId = this.hashSubjectIds ? hashPii(subjectId) : subjectId
    
    // Log the deletion as an audit event first
    await this.log({
      action: 'pii.deleted',
      actor: { type: 'system', id: 'audit-service' },
      subject: { type: 'user', id: subjectId },
      resource: { type: 'audit_logs', id: lookupId },
      projectId: 'system',
      metadata: { reason: 'GDPR right to erasure' },
    })

    const result = await this.db
      .delete(auditLogs)
      .where(eq(auditLogs.subjectId, lookupId))

    // Drizzle returns different types based on driver
    return (result as any).rowCount ?? (result as any).changes ?? 0
  }

  /**
   * Export audit logs for a subject (for GDPR right of access)
   */
  async exportBySubject(subjectId: string): Promise<AuditLog[]> {
    // Log the export as an audit event
    await this.log({
      action: 'pii.exported',
      actor: { type: 'system', id: 'audit-service' },
      subject: { type: 'user', id: subjectId },
      resource: { type: 'audit_logs', id: 'export' },
      projectId: 'system',
      metadata: { reason: 'GDPR right of access' },
    })

    return this.findBySubject(subjectId)
  }
}
