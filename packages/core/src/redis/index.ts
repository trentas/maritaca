/**
 * Redis connection configuration
 */
export interface RedisConnectionConfig {
  host: string
  port: number
  password?: string
  username?: string
  db?: number
}

/**
 * Parse a Redis URL into connection configuration
 * Supports redis:// and rediss:// (TLS) protocols
 * 
 * @param redisUrl - Redis connection URL (e.g., redis://user:pass@host:6379/0)
 * @returns RedisConnectionConfig object compatible with ioredis/bullmq
 */
export function parseRedisUrl(redisUrl: string): RedisConnectionConfig {
  const url = new URL(redisUrl)
  
  const config: RedisConnectionConfig = {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
  }

  if (url.password) {
    config.password = url.password
  }

  if (url.username) {
    config.username = url.username
  }

  // Parse database number from path (e.g., /0)
  if (url.pathname && url.pathname.length > 1) {
    const dbNumber = parseInt(url.pathname.slice(1), 10)
    if (!isNaN(dbNumber)) {
      config.db = dbNumber
    }
  }

  return config
}
