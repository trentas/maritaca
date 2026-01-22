/**
 * Audit log types for GDPR/LGPD compliance
 * 
 * Audit logs are stored separately from system logs and contain:
 * - Full PII data (encrypted)
 * - Structured event information for compliance queries
 * - Trace context for correlation with system logs
 */

/**
 * Actions that can be audited
 */
export type AuditAction =
  // Message lifecycle
  | 'message.created'
  | 'message.queued'
  | 'message.delivered'
  | 'message.failed'
  // Email channel
  | 'email.sent'
  | 'email.delivered'
  | 'email.failed'
  | 'email.bounced'
  | 'email.complained'
  // Slack channel
  | 'slack.sent'
  | 'slack.delivered'
  | 'slack.failed'
  // PII operations (for compliance tracking)
  | 'pii.accessed'
  | 'pii.exported'
  | 'pii.deleted'
  // API operations
  | 'api.authenticated'
  | 'api.unauthorized'

/**
 * Actor types - who performed the action
 */
export type AuditActorType = 'system' | 'user' | 'api_key' | 'admin'

/**
 * Actor information
 */
export interface AuditActor {
  /** Type of actor */
  type: AuditActorType
  /** Actor identifier (e.g., worker ID, user ID, API key prefix) */
  id: string
}

/**
 * Subject information - who is affected by the action
 * Used for DSAR (Data Subject Access Request) queries
 */
export interface AuditSubject {
  /** Type of subject */
  type: 'user' | 'recipient' | 'contact'
  /** Subject identifier (should be hashed for privacy) */
  id: string
}

/**
 * Resource information - what was acted upon
 */
export interface AuditResource {
  /** Type of resource */
  type: 'message' | 'notification' | 'template' | 'api_key' | 'audit_logs' | string
  /** Resource identifier */
  id: string
}

/**
 * Audit event to be logged
 */
export interface AuditEvent {
  /** Action performed */
  action: AuditAction
  /** Who performed the action */
  actor: AuditActor
  /** Who is affected (optional, for DSAR queries) */
  subject?: AuditSubject
  /** What was acted upon */
  resource: AuditResource
  /** Project/tenant ID */
  projectId: string
  /** Request ID for correlation */
  requestId?: string
  /** PII data to be encrypted and stored */
  piiData?: Record<string, unknown>
  /** Non-PII metadata */
  metadata?: Record<string, unknown>
}

/**
 * Stored audit log record
 */
export interface AuditLog {
  id: string
  createdAt: Date
  action: AuditAction
  actorType: AuditActorType
  actorId: string
  subjectType?: string
  subjectId?: string
  resourceType: string
  resourceId: string
  projectId: string
  requestId?: string
  traceId?: string
  /** Encrypted PII data */
  piiData?: Record<string, unknown>
  /** Non-PII metadata */
  metadata?: Record<string, unknown>
}

/**
 * Options for querying audit logs
 */
export interface AuditQueryOptions {
  /** Filter by subject ID (for DSAR) */
  subjectId?: string
  /** Filter by project ID */
  projectId?: string
  /** Filter by resource ID */
  resourceId?: string
  /** Filter by action */
  action?: AuditAction
  /** Start date (inclusive) */
  startDate?: Date
  /** End date (exclusive) */
  endDate?: Date
  /** Maximum number of results */
  limit?: number
  /** Offset for pagination */
  offset?: number
}
