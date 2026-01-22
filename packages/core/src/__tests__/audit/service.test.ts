import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AuditService } from '../../audit/service.js'
import { encryptPii, decryptPii, isEncryptedData } from '../../audit/encryption.js'
import { hashPii } from '../../logger/masking.js'

// Mock the database
const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })
const mockSelect = vi.fn()
const mockDelete = vi.fn()

const mockDb = {
  insert: mockInsert,
  select: mockSelect,
  delete: mockDelete,
} as any

describe('AuditService', () => {
  const encryptionKey = 'test-encryption-key-32-chars!!'
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('constructor', () => {
    it('should create service with encryption key from options', () => {
      const service = new AuditService(mockDb, { encryptionKey })
      expect(service).toBeDefined()
    })

    it('should use encryption key from env if not in options', () => {
      process.env.AUDIT_ENCRYPTION_KEY = 'env-key'
      const service = new AuditService(mockDb)
      expect(service).toBeDefined()
    })

    it('should default hashSubjectIds to true', () => {
      const service = new AuditService(mockDb, { encryptionKey })
      expect(service).toBeDefined()
    })

    it('should respect hashSubjectIds option', () => {
      const service = new AuditService(mockDb, { 
        encryptionKey,
        hashSubjectIds: false,
      })
      expect(service).toBeDefined()
    })
  })

  describe('log', () => {
    it('should log audit event with encrypted PII', async () => {
      const mockValues = vi.fn().mockResolvedValue(undefined)
      mockInsert.mockReturnValue({ values: mockValues })

      const service = new AuditService(mockDb, { encryptionKey })
      
      const id = await service.log({
        action: 'email.sent',
        actor: { type: 'system', id: 'resend-provider' },
        subject: { type: 'recipient', id: 'user@example.com' },
        resource: { type: 'message', id: 'msg-123' },
        projectId: 'proj_123',
        piiData: { recipient: 'user@example.com' },
      })

      expect(id).toBeDefined()
      expect(mockInsert).toHaveBeenCalled()
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'email.sent',
          actorType: 'system',
          actorId: 'resend-provider',
          resourceType: 'message',
          resourceId: 'msg-123',
          projectId: 'proj_123',
        })
      )

      // Verify PII is encrypted
      const callArg = mockValues.mock.calls[0][0]
      expect(callArg.piiData).toHaveProperty('iv')
      expect(callArg.piiData).toHaveProperty('content')
      expect(callArg.piiData).toHaveProperty('tag')
    })

    it('should hash subject ID when hashSubjectIds is true', async () => {
      const mockValues = vi.fn().mockResolvedValue(undefined)
      mockInsert.mockReturnValue({ values: mockValues })

      const service = new AuditService(mockDb, { 
        encryptionKey,
        hashSubjectIds: true,
      })

      await service.log({
        action: 'email.sent',
        actor: { type: 'system', id: 'provider' },
        subject: { type: 'user', id: 'user@example.com' },
        resource: { type: 'message', id: 'msg-123' },
        projectId: 'proj_123',
      })

      const callArg = mockValues.mock.calls[0][0]
      expect(callArg.subjectId).toBe(hashPii('user@example.com'))
      expect(callArg.subjectId).not.toBe('user@example.com')
    })

    it('should NOT hash subject ID when hashSubjectIds is false', async () => {
      const mockValues = vi.fn().mockResolvedValue(undefined)
      mockInsert.mockReturnValue({ values: mockValues })

      const service = new AuditService(mockDb, { 
        encryptionKey,
        hashSubjectIds: false,
      })

      await service.log({
        action: 'email.sent',
        actor: { type: 'system', id: 'provider' },
        subject: { type: 'user', id: 'user@example.com' },
        resource: { type: 'message', id: 'msg-123' },
        projectId: 'proj_123',
      })

      const callArg = mockValues.mock.calls[0][0]
      expect(callArg.subjectId).toBe('user@example.com')
    })

    it('should store warning when no encryption key', async () => {
      const mockValues = vi.fn().mockResolvedValue(undefined)
      mockInsert.mockReturnValue({ values: mockValues })

      const service = new AuditService(mockDb, { encryptionKey: undefined })

      await service.log({
        action: 'email.sent',
        actor: { type: 'system', id: 'provider' },
        resource: { type: 'message', id: 'msg-123' },
        projectId: 'proj_123',
        piiData: { email: 'user@example.com' },
      })

      const callArg = mockValues.mock.calls[0][0]
      expect(callArg.piiData).toEqual({
        warning: 'PII not encrypted - no encryption key configured',
      })
    })

    it('should include metadata', async () => {
      const mockValues = vi.fn().mockResolvedValue(undefined)
      mockInsert.mockReturnValue({ values: mockValues })

      const service = new AuditService(mockDb, { encryptionKey })

      await service.log({
        action: 'email.sent',
        actor: { type: 'system', id: 'provider' },
        resource: { type: 'message', id: 'msg-123' },
        projectId: 'proj_123',
        metadata: { channel: 'email', provider: 'resend' },
      })

      const callArg = mockValues.mock.calls[0][0]
      expect(callArg.metadata).toEqual({ channel: 'email', provider: 'resend' })
    })

    it('should include requestId', async () => {
      const mockValues = vi.fn().mockResolvedValue(undefined)
      mockInsert.mockReturnValue({ values: mockValues })

      const service = new AuditService(mockDb, { encryptionKey })

      await service.log({
        action: 'email.sent',
        actor: { type: 'system', id: 'provider' },
        resource: { type: 'message', id: 'msg-123' },
        projectId: 'proj_123',
        requestId: 'req-456',
      })

      const callArg = mockValues.mock.calls[0][0]
      expect(callArg.requestId).toBe('req-456')
    })
  })

  describe('find', () => {
    it('should find logs by projectId', async () => {
      const mockResults = [
        {
          id: 'log-1',
          createdAt: new Date(),
          action: 'email.sent',
          actorType: 'system',
          actorId: 'provider',
          resourceType: 'message',
          resourceId: 'msg-1',
          projectId: 'proj_123',
        },
      ]

      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue(mockResults),
              }),
            }),
          }),
        }),
      })

      const service = new AuditService(mockDb, { encryptionKey })
      const results = await service.find({ projectId: 'proj_123' })

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('log-1')
    })

    it('should apply default limit and offset', async () => {
      const mockLimit = vi.fn().mockReturnValue({
        offset: vi.fn().mockResolvedValue([]),
      })

      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: mockLimit,
            }),
          }),
        }),
      })

      const service = new AuditService(mockDb, { encryptionKey })
      await service.find({})

      expect(mockLimit).toHaveBeenCalledWith(100)
    })
  })

  describe('findBySubject', () => {
    it('should call find with subjectId', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      })

      const service = new AuditService(mockDb, { encryptionKey })
      await service.findBySubject('user@example.com')

      expect(mockSelect).toHaveBeenCalled()
    })
  })

  describe('findByResource', () => {
    it('should call find with resourceId', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      })

      const service = new AuditService(mockDb, { encryptionKey })
      await service.findByResource('msg-123')

      expect(mockSelect).toHaveBeenCalled()
    })
  })

  describe('decryptPii', () => {
    it('should decrypt PII data', () => {
      const service = new AuditService(mockDb, { encryptionKey })
      
      const originalData = { email: 'user@example.com', name: 'John' }
      const encrypted = encryptPii(originalData, encryptionKey)

      const auditLog = {
        id: 'log-1',
        createdAt: new Date(),
        action: 'email.sent' as const,
        actorType: 'system' as const,
        actorId: 'provider',
        resourceType: 'message',
        resourceId: 'msg-1',
        projectId: 'proj_123',
        piiData: encrypted as unknown as Record<string, unknown>,
      }

      const decrypted = service.decryptPii(auditLog)
      expect(decrypted).toEqual(originalData)
    })

    it('should throw if no encryption key', () => {
      const service = new AuditService(mockDb, { encryptionKey: undefined })

      const auditLog = {
        id: 'log-1',
        createdAt: new Date(),
        action: 'email.sent' as const,
        actorType: 'system' as const,
        actorId: 'provider',
        resourceType: 'message',
        resourceId: 'msg-1',
        projectId: 'proj_123',
        piiData: { encrypted: 'data' },
      }

      expect(() => service.decryptPii(auditLog)).toThrow('Encryption key is required')
    })

    it('should throw if no PII data', () => {
      const service = new AuditService(mockDb, { encryptionKey })

      const auditLog = {
        id: 'log-1',
        createdAt: new Date(),
        action: 'email.sent' as const,
        actorType: 'system' as const,
        actorId: 'provider',
        resourceType: 'message',
        resourceId: 'msg-1',
        projectId: 'proj_123',
      }

      expect(() => service.decryptPii(auditLog)).toThrow('No PII data in audit log')
    })

    it('should throw if PII data is not encrypted', () => {
      const service = new AuditService(mockDb, { encryptionKey })

      const auditLog = {
        id: 'log-1',
        createdAt: new Date(),
        action: 'email.sent' as const,
        actorType: 'system' as const,
        actorId: 'provider',
        resourceType: 'message',
        resourceId: 'msg-1',
        projectId: 'proj_123',
        piiData: { plainData: 'not encrypted' },
      }

      expect(() => service.decryptPii(auditLog)).toThrow('PII data is not encrypted')
    })
  })

  describe('deleteBySubject', () => {
    it('should log deletion and delete records', async () => {
      const mockValues = vi.fn().mockResolvedValue(undefined)
      mockInsert.mockReturnValue({ values: mockValues })
      mockDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue({ rowCount: 5 }),
      })

      const service = new AuditService(mockDb, { encryptionKey })
      const count = await service.deleteBySubject('user@example.com')

      // Should log the deletion first
      expect(mockInsert).toHaveBeenCalled()
      const logCall = mockValues.mock.calls[0][0]
      expect(logCall.action).toBe('pii.deleted')

      // Should delete records
      expect(mockDelete).toHaveBeenCalled()
      expect(count).toBe(5)
    })
  })

  describe('exportBySubject', () => {
    it('should log export and return records', async () => {
      const mockValues = vi.fn().mockResolvedValue(undefined)
      mockInsert.mockReturnValue({ values: mockValues })
      
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue([
                  {
                    id: 'log-1',
                    createdAt: new Date(),
                    action: 'email.sent',
                    actorType: 'system',
                    actorId: 'provider',
                    resourceType: 'message',
                    resourceId: 'msg-1',
                    projectId: 'proj_123',
                  },
                ]),
              }),
            }),
          }),
        }),
      })

      const service = new AuditService(mockDb, { encryptionKey })
      const results = await service.exportBySubject('user@example.com')

      // Should log the export
      expect(mockInsert).toHaveBeenCalled()
      const logCall = mockValues.mock.calls[0][0]
      expect(logCall.action).toBe('pii.exported')

      // Should return results
      expect(results).toHaveLength(1)
    })
  })
})
