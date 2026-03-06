import { FastifyPluginAsync } from 'fastify'
import { createHmac, timingSafeEqual } from 'crypto'
import { IntegrationService } from '@maritaca/core/integrations'

/**
 * State token helpers using HMAC-SHA256
 * Avoids adding a JWT dependency — state is short-lived and simple
 */
const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes

function createState(payload: Record<string, string>, secret: string): string {
  const data = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + STATE_TTL_MS })).toString('base64url')
  const sig = createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${sig}`
}

function verifyState(state: string, secret: string): Record<string, string> & { exp: number } {
  const [data, sig] = state.split('.')
  if (!data || !sig) throw new Error('Invalid state format')

  const expectedSig = createHmac('sha256', secret).update(data).digest('base64url')
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    throw new Error('Invalid state signature')
  }

  const payload = JSON.parse(Buffer.from(data, 'base64url').toString())
  if (typeof payload.exp === 'number' && Date.now() > payload.exp) {
    throw new Error('State token expired')
  }
  return payload
}

/**
 * Slack integration routes
 * Handles OAuth flow and integration management
 */
export const slackIntegrationRoutes: FastifyPluginAsync = async (fastify) => {
  const signingSecret = process.env.SLACK_SIGNING_SECRET
  const clientId = process.env.SLACK_CLIENT_ID
  const clientSecret = process.env.SLACK_CLIENT_SECRET
  const encryptionKey = process.env.INTEGRATION_ENCRYPTION_KEY

  /**
   * GET /v1/integrations/slack/authorize
   * Starts the OAuth flow — redirects the user to Slack consent screen
   * Requires authentication (API key → projectId)
   */
  fastify.get<{
    Querystring: { redirectUri: string }
  }>('/v1/integrations/slack/authorize', async (request, reply) => {
    if (!clientId || !signingSecret) {
      return reply.code(500).send({
        error: 'Configuration Error',
        message: 'Slack OAuth is not configured (SLACK_CLIENT_ID / SLACK_SIGNING_SECRET missing)',
      })
    }

    const projectId = request.projectId
    if (!projectId) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Project ID not found in request' })
    }

    const { redirectUri } = request.query
    if (!redirectUri) {
      return reply.code(400).send({ error: 'Bad Request', message: 'redirectUri query parameter is required' })
    }

    const state = createState({ projectId, redirectUri }, signingSecret)

    // Build the Slack OAuth URL — use https for non-localhost (proxy / production)
    const isLocal = request.hostname === 'localhost' || request.hostname.startsWith('127.')
    const proto = isLocal ? 'http' : 'https'
    const callbackUrl = `${proto}://${request.hostname}/v1/integrations/slack/callback`
    const params = new URLSearchParams({
      client_id: clientId,
      scope: 'chat:write,users:read,users:read.email',
      redirect_uri: callbackUrl,
      state,
    })

    return reply.redirect(`https://slack.com/oauth/v2/authorize?${params}`)
  })

  /**
   * GET /v1/integrations/slack/callback
   * OAuth callback — called by Slack after user consent
   * No authentication (called by Slack redirect)
   */
  fastify.get<{
    Querystring: { code?: string; state?: string; error?: string }
  }>('/v1/integrations/slack/callback', async (request, reply) => {
    if (!signingSecret || !clientId || !clientSecret || !encryptionKey) {
      return reply.code(500).send({
        error: 'Configuration Error',
        message: 'Slack OAuth is not configured',
      })
    }

    const { code, state, error: slackError } = request.query

    // If Slack returned an error (e.g. user denied)
    if (slackError) {
      request.log.warn({ slackError }, 'Slack OAuth error')
      // Try to extract redirectUri from state for user redirect
      try {
        const payload = verifyState(state || '', signingSecret)
        return reply.redirect(`${payload.redirectUri}?status=error&error=${encodeURIComponent(slackError)}`)
      } catch {
        return reply.code(400).send({ error: 'OAuth Error', message: slackError })
      }
    }

    if (!code || !state) {
      return reply.code(400).send({ error: 'Bad Request', message: 'Missing code or state parameter' })
    }

    // Verify and decode state
    let payload: { projectId: string; redirectUri: string; exp: number }
    try {
      payload = verifyState(state, signingSecret) as any
    } catch (err: any) {
      request.log.warn({ err }, 'Invalid OAuth state')
      return reply.code(400).send({ error: 'Bad Request', message: err.message })
    }

    const { projectId, redirectUri } = payload

    // Exchange code for token
    try {
      const proto = (request.headers['x-forwarded-proto'] as string) || request.protocol
      const callbackUrl = `${proto}://${request.hostname}/v1/integrations/slack/callback`
      const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: callbackUrl,
        }),
      })

      const tokenData = await tokenResponse.json() as {
        ok: boolean
        error?: string
        access_token?: string
        team?: { id: string; name: string }
        bot_user_id?: string
        app_id?: string
        scope?: string
        authed_user?: { id: string }
      }

      if (!tokenData.ok || !tokenData.access_token) {
        request.log.error({ tokenData }, 'Slack token exchange failed')
        return reply.redirect(`${redirectUri}?status=error&error=${encodeURIComponent(tokenData.error || 'token_exchange_failed')}`)
      }

      // Save encrypted credentials
      const integrationService = new IntegrationService(request.server.db, encryptionKey)
      await integrationService.upsert(
        projectId,
        'slack',
        'slack',
        { botToken: tokenData.access_token },
        {
          teamId: tokenData.team?.id,
          teamName: tokenData.team?.name,
          botUserId: tokenData.bot_user_id,
          appId: tokenData.app_id,
          scope: tokenData.scope,
        },
      )

      request.log.info(
        { projectId, teamId: tokenData.team?.id, teamName: tokenData.team?.name },
        'Slack integration installed',
      )

      const teamName = tokenData.team?.name || ''
      return reply.redirect(`${redirectUri}?status=success&team=${encodeURIComponent(teamName)}`)
    } catch (err: any) {
      request.log.error({ err }, 'Slack OAuth callback error')
      return reply.redirect(`${redirectUri}?status=error&error=${encodeURIComponent('internal_error')}`)
    }
  })

  /**
   * GET /v1/integrations/slack/status
   * Returns integration status for the authenticated project
   */
  fastify.get('/v1/integrations/slack/status', async (request, reply) => {
    if (!encryptionKey) {
      return reply.code(500).send({ error: 'Configuration Error', message: 'INTEGRATION_ENCRYPTION_KEY not configured' })
    }

    const projectId = request.projectId
    if (!projectId) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Project ID not found in request' })
    }

    const integrationService = new IntegrationService(request.server.db, encryptionKey)
    const status = await integrationService.getStatus(projectId, 'slack')

    return reply.send({
      active: status.active,
      teamName: (status.metadata as any)?.teamName,
      teamId: (status.metadata as any)?.teamId,
      installedAt: status.installedAt,
    })
  })

  /**
   * DELETE /v1/integrations/slack
   * Revoke the Slack integration for the authenticated project
   */
  fastify.delete('/v1/integrations/slack', async (request, reply) => {
    if (!encryptionKey) {
      return reply.code(500).send({ error: 'Configuration Error', message: 'INTEGRATION_ENCRYPTION_KEY not configured' })
    }

    const projectId = request.projectId
    if (!projectId) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Project ID not found in request' })
    }

    const integrationService = new IntegrationService(request.server.db, encryptionKey)

    // Optionally revoke the token at Slack
    try {
      const credentials = await integrationService.getCredentials(projectId, 'slack')
      if (credentials?.botToken) {
        await fetch('https://slack.com/api/auth.revoke', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${credentials.botToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        })
      }
    } catch (err) {
      // Best-effort revocation — don't fail if Slack is unreachable
      request.log.warn({ err }, 'Failed to revoke Slack token at Slack API')
    }

    await integrationService.revoke(projectId, 'slack')

    request.log.info({ projectId }, 'Slack integration revoked')
    return reply.send({ status: 'revoked' })
  })
}
