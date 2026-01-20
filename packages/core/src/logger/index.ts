import pino from 'pino'
import { context, trace } from '@opentelemetry/api'

/**
 * Logger configuration options
 */
export interface LoggerOptions {
  /**
   * Log level (trace, debug, info, warn, error, fatal)
   * @default 'info'
   */
  level?: string

  /**
   * Service name
   * @default 'maritaca'
   */
  serviceName?: string

  /**
   * Service version
   * @default '0.1.0'
   */
  serviceVersion?: string

  /**
   * Enable pretty printing (for development)
   * @default false in production, true in development
   */
  pretty?: boolean
}

const defaultPinoFormatters: pino.LoggerOptions['formatters'] = {
  level: (label) => ({ level: label }),
  log: (object) => {
    const activeContext = context.active()
    const span = trace.getSpan(activeContext)
    if (span) {
      const spanContext = span.spanContext()
      return {
        ...object,
        traceId: spanContext.traceId,
        spanId: spanContext.spanId,
        traceFlags: spanContext.traceFlags,
      }
    }
    return object
  },
}

/**
 * Create a Pino logger instance with OpenTelemetry trace context integration.
 * Injects traceId and spanId when a span is active. If OTEL_EXPORTER_OTLP_LOGS_ENDPOINT
 * is set, logs are also sent to that OTLP endpoint (e.g. SigNoz) via pino-opentelemetry-transport.
 */
export async function createLogger(options: LoggerOptions = {}): Promise<pino.Logger> {
  const {
    level = process.env.LOG_LEVEL || 'info',
    serviceName = 'maritaca',
    serviceVersion = '0.1.0',
    pretty = process.env.NODE_ENV !== 'production',
  } = options

  const baseOpts: pino.LoggerOptions = {
    level,
    base: { service: serviceName, version: serviceVersion },
    formatters: defaultPinoFormatters,
  }

  const logsEndpoint =
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ||
    (process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      ? `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, '')}/v1/logs`
      : undefined)

  if (logsEndpoint) {
    const targets: pino.TransportTargetOptions[] = [
      pretty
        ? {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
          }
        : { target: 'pino/file', options: { destination: 1 } },
      {
        target: 'pino-opentelemetry-transport',
        options: {
          serviceVersion,
          resourceAttributes: { 'service.name': serviceName },
        },
      },
    ]
    const stream = await pino.transport({ targets })
    return pino(baseOpts, stream)
  }

  if (pretty) {
    return pino({
      ...baseOpts,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
      },
    })
  }

  return pino(baseOpts)
}

/**
 * Create a synchronous Pino logger (no OTLP, no async transport).
 * Use when createLogger's async API is not suitable (e.g. in constructors).
 * Still injects traceId/spanId when a span is active.
 */
export function createSyncLogger(options: LoggerOptions = {}): pino.Logger {
  const {
    level = process.env.LOG_LEVEL || 'info',
    serviceName = 'maritaca',
    serviceVersion = '0.1.0',
  } = options
  return pino({
    level,
    base: { service: serviceName, version: serviceVersion },
    formatters: defaultPinoFormatters,
  })
}

/**
 * Create a child logger with additional context
 * 
 * Child loggers inherit the parent's configuration and add additional context fields
 * to all log entries. Useful for adding request IDs, message IDs, etc.
 */
export function createChildLogger(
  parent: pino.Logger,
  context: Record<string, unknown>,
): pino.Logger {
  return parent.child(context)
}

/**
 * Export Pino logger type
 */
export type Logger = pino.Logger
