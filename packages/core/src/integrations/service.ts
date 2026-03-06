import { eq, and } from 'drizzle-orm'
import type { DbClient } from '../db/client.js'
import { integrations, type Integration } from '../db/schema.js'
import { encryptCredentials, decryptCredentials } from './encryption.js'
import type { EncryptedData } from '../audit/encryption.js'

export interface IntegrationMetadata {
  teamId?: string
  teamName?: string
  botUserId?: string
  appId?: string
  scope?: string
  [key: string]: unknown
}

export class IntegrationService {
  constructor(
    private db: DbClient,
    private encryptionKey: string,
  ) {}

  /**
   * Upsert an integration (insert or update on conflict)
   * Called after a successful OAuth callback
   */
  async upsert(
    projectId: string,
    channel: string,
    provider: string,
    rawCredentials: Record<string, string>,
    metadata?: IntegrationMetadata,
    installedBy?: string,
  ): Promise<Integration> {
    const encrypted = encryptCredentials(rawCredentials, this.encryptionKey)

    const existing = await this.db
      .select()
      .from(integrations)
      .where(
        and(
          eq(integrations.projectId, projectId),
          eq(integrations.channel, channel),
          eq(integrations.provider, provider),
        ),
      )
      .limit(1)

    if (existing.length > 0) {
      const [updated] = await this.db
        .update(integrations)
        .set({
          credentials: encrypted,
          metadata: metadata ?? existing[0].metadata,
          status: 'active',
          installedAt: new Date(),
          installedBy: installedBy ?? existing[0].installedBy,
          updatedAt: new Date(),
        })
        .where(eq(integrations.id, existing[0].id))
        .returning()
      return updated
    }

    const [created] = await this.db
      .insert(integrations)
      .values({
        projectId,
        channel,
        provider,
        credentials: encrypted,
        metadata,
        status: 'active',
        installedAt: new Date(),
        installedBy,
      })
      .returning()
    return created
  }

  /**
   * Get the active integration for a project/channel
   */
  async getActive(projectId: string, channel: string): Promise<Integration | null> {
    const [row] = await this.db
      .select()
      .from(integrations)
      .where(
        and(
          eq(integrations.projectId, projectId),
          eq(integrations.channel, channel),
          eq(integrations.status, 'active'),
        ),
      )
      .limit(1)
    return row ?? null
  }

  /**
   * Decrypt and return credentials for a project/channel
   * Returns null if no active integration exists
   */
  async getCredentials(projectId: string, channel: string): Promise<Record<string, string> | null> {
    const integration = await this.getActive(projectId, channel)
    if (!integration) return null
    return decryptCredentials(integration.credentials as EncryptedData, this.encryptionKey)
  }

  /**
   * Revoke an integration (soft delete — sets status to 'revoked')
   */
  async revoke(projectId: string, channel: string): Promise<void> {
    await this.db
      .update(integrations)
      .set({ status: 'revoked', updatedAt: new Date() })
      .where(
        and(
          eq(integrations.projectId, projectId),
          eq(integrations.channel, channel),
          eq(integrations.status, 'active'),
        ),
      )
  }

  /**
   * Get integration status for a project/channel
   */
  async getStatus(projectId: string, channel: string): Promise<{
    active: boolean
    metadata?: IntegrationMetadata
    installedAt?: Date | null
  }> {
    const integration = await this.getActive(projectId, channel)
    if (!integration) {
      return { active: false }
    }
    return {
      active: true,
      metadata: integration.metadata as IntegrationMetadata | undefined,
      installedAt: integration.installedAt,
    }
  }
}
