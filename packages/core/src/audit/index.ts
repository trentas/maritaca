/**
 * Audit module for GDPR/LGPD compliance
 * 
 * This module provides:
 * - AuditService for structured audit logging
 * - PII encryption/decryption
 * - Partition management for large-scale deployments
 */

export { AuditService, type AuditServiceOptions } from './service.js'
export { encryptPii, decryptPii, isEncryptedData, type EncryptedData } from './encryption.js'
export {
  createPartition,
  ensurePartitions,
  dropPartition,
  detachPartition,
  dropOldPartitions,
  getPartitionStats,
  isAuditLogsPartitioned,
} from './partitions.js'
