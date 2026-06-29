import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import { IntegrationService } from '@maritaca/core/integrations'

// Mock the Slack WebClient so we can drive conversations.list / conversations.join.
const { listMock, joinMock } = vi.hoisted(() => ({ listMock: vi.fn(), joinMock: vi.fn() }))

vi.mock('@slack/web-api', () => ({
  // Regular function (not arrow) so it can be invoked with `new`.
  WebClient: vi.fn(function (this: any) {
    this.conversations = { list: listMock, join: joinMock }
  }),
}))

import { slackIntegrationRoutes } from '../../../routes/integrations/slack.js'

function slackThrow(error: string): any {
  return Object.assign(new Error(error), { data: { ok: false, error } })
}

async function buildApp(projectIdRef: { value: string | undefined }): Promise<FastifyInstance> {
  const app = Fastify()
  app.decorate('db', {} as any)
  // Stand in for the global auth middleware which normally sets request.projectId
  app.addHook('preHandler', (req, _reply, done) => {
    ;(req as any).projectId = projectIdRef.value
    done()
  })
  await app.register(slackIntegrationRoutes)
  await app.ready()
  return app
}

describe('Slack channel routes', () => {
  let app: FastifyInstance
  const projectIdRef = { value: 'tenant-acme' as string | undefined }
  let getCredentials: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = 'test-encryption-key'
    projectIdRef.value = 'tenant-acme'
    listMock.mockReset()
    joinMock.mockReset()
    // The route stores credentials per project; default to a connected integration.
    getCredentials = vi
      .spyOn(IntegrationService.prototype, 'getCredentials')
      .mockResolvedValue({ botToken: 'xoxb-test-token' })
    app = await buildApp(projectIdRef)
  })

  afterEach(async () => {
    await app.close()
    getCredentials.mockRestore()
    delete process.env.INTEGRATION_ENCRYPTION_KEY
  })

  // --- resolve ---

  it('resolves a channel name to its ID (200)', async () => {
    listMock.mockResolvedValue({
      ok: true,
      channels: [{ id: 'C08ABC', name: 'alertas-custos-datadog', is_private: false, is_member: true }],
    })

    const res = await app.inject({
      method: 'POST',
      url: '/v1/integrations/slack/channels/resolve',
      payload: { channelName: 'alertas-custos-datadog' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      channelId: 'C08ABC',
      channelName: 'alertas-custos-datadog',
      isPrivate: false,
      isMember: true,
    })
  })

  it('returns 404 when the channel is not found', async () => {
    listMock.mockResolvedValue({ ok: true, channels: [], response_metadata: { next_cursor: '' } })
    const res = await app.inject({
      method: 'POST',
      url: '/v1/integrations/slack/channels/resolve',
      payload: { channelName: 'ghost' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('rejects resolve without a channelName (400)', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/integrations/slack/channels/resolve', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('maps a missing scope to 403', async () => {
    listMock.mockRejectedValue(slackThrow('missing_scope'))
    const res = await app.inject({
      method: 'POST',
      url: '/v1/integrations/slack/channels/resolve',
      payload: { channelName: 'general' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('missing_scope')
  })

  // --- join ---

  it('joins a public channel (200)', async () => {
    joinMock.mockResolvedValue({ ok: true, channel: { id: 'C08ABC', name: 'general' } })
    const res = await app.inject({ method: 'POST', url: '/v1/integrations/slack/channels/C08ABC/join' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ channelId: 'C08ABC', joined: true })
  })

  it('returns 403 for a private channel', async () => {
    joinMock.mockRejectedValue(slackThrow('method_not_supported_for_channel_type'))
    const res = await app.inject({ method: 'POST', url: '/v1/integrations/slack/channels/C08PRIV/join' })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('channel_is_private')
  })

  // --- auth / connection gating ---

  it('returns 401 when no project is resolved', async () => {
    projectIdRef.value = undefined
    const res = await app.inject({
      method: 'POST',
      url: '/v1/integrations/slack/channels/resolve',
      payload: { channelName: 'general' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when the project has no Slack integration', async () => {
    getCredentials.mockResolvedValue(null)
    const res = await app.inject({ method: 'POST', url: '/v1/integrations/slack/channels/C1/join' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Slack Not Connected')
  })

  it('returns 500 when the encryption key is not configured', async () => {
    await app.close()
    delete process.env.INTEGRATION_ENCRYPTION_KEY
    app = await buildApp(projectIdRef)

    const res = await app.inject({
      method: 'POST',
      url: '/v1/integrations/slack/channels/resolve',
      payload: { channelName: 'general' },
    })
    expect(res.statusCode).toBe(500)
  })
})
