import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import { IntegrationService } from '@maritaca/core/integrations'
import { slackIntegrationRoutes } from '../../../routes/integrations/slack.js'

const FULL_SCOPE =
  'chat:write,chat:write.customize,users:read,users:read.email,channels:read,groups:read,channels:join'
const OLD_SCOPE = 'chat:write,chat:write.customize,users:read,users:read.email'

async function buildApp(projectIdRef: { value: string | undefined }): Promise<FastifyInstance> {
  const app = Fastify()
  app.decorate('db', {} as any)
  app.addHook('preHandler', (req, _reply, done) => {
    ;(req as any).projectId = projectIdRef.value
    done()
  })
  await app.register(slackIntegrationRoutes)
  await app.ready()
  return app
}

describe('Slack status — scope detection', () => {
  let app: FastifyInstance
  const projectIdRef = { value: 'tenant-acme' as string | undefined }
  let getStatus: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = 'test-encryption-key'
    projectIdRef.value = 'tenant-acme'
    getStatus = vi.spyOn(IntegrationService.prototype, 'getStatus')
    app = await buildApp(projectIdRef)
  })

  afterEach(async () => {
    await app.close()
    getStatus.mockRestore()
    delete process.env.INTEGRATION_ENCRYPTION_KEY
  })

  it('reports needsReauth=false when all scopes are granted', async () => {
    getStatus.mockResolvedValue({
      active: true,
      metadata: { teamName: 'Acme', teamId: 'T1', scope: FULL_SCOPE },
      installedAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const res = await app.inject({ method: 'GET', url: '/v1/integrations/slack/status' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.active).toBe(true)
    expect(body.needsReauth).toBe(false)
    expect(body.missingScopes).toEqual([])
    expect(body.scopes).toContain('channels:join')
  })

  it('flags needsReauth for an integration installed before the channel scopes', async () => {
    getStatus.mockResolvedValue({
      active: true,
      metadata: { teamName: 'Acme', teamId: 'T1', scope: OLD_SCOPE },
      installedAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const res = await app.inject({ method: 'GET', url: '/v1/integrations/slack/status' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.needsReauth).toBe(true)
    expect(body.missingScopes).toEqual(['channels:read', 'groups:read', 'channels:join'])
  })

  it('returns empty scopes and needsReauth=false when not connected', async () => {
    getStatus.mockResolvedValue({ active: false })

    const res = await app.inject({ method: 'GET', url: '/v1/integrations/slack/status' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.active).toBe(false)
    expect(body.scopes).toEqual([])
    expect(body.needsReauth).toBe(false)
  })

  it('returns 401 when no project is resolved', async () => {
    projectIdRef.value = undefined
    const res = await app.inject({ method: 'GET', url: '/v1/integrations/slack/status' })
    expect(res.statusCode).toBe(401)
  })
})
